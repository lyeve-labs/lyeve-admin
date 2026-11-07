import type { PageServerLoad, Actions } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { authedClient, requireRole } from '$lib/server/authz';
import { sessionTenant } from '$lib/server/session-refresh';
import { actionFailure } from '$lib/server/action-error';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning } from '$lib/plugins';
import {
	createRule,
	deleteRule,
	flushAll,
	flushTag,
	listEntries,
	listProviders,
	listRules,
	parseTags,
	patternIsSound,
	purgeResponses,
	purgeRule,
	readStats,
	resetCircuit,
	tagIsSound,
	updateRule,
	type CacheEntry,
	type CacheProvider,
	type CacheRule,
	type CacheStats,
	type InactiveProvider,
	type Limit,
} from '$lib/api/cache';
import { type Gate, GATE_OK, section } from '$lib/api/gate';
import { pageOf, pageWindow, pastEndOffset, rowsOf, withOffset } from '$lib/api/list';
import { couldNotLoad } from '$lib/outage';

/** What the response cache rules read answered, beside the rest of the page. */
export interface RulesState {
	gate: Gate;
	rows: CacheRule[];
	/** Null when the read did not say. */
	licensed: boolean | null;
	limit: Limit | undefined;
}

/** The longest TTL the form offers: a year. The plugin takes more, and nobody means it. */
const MAX_TTL_SECONDS = 365 * 86400;

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export const load: PageServerLoad = async (event) => {
	const { plugins, user } = await event.parent();
	const { limit, offset } = pageWindow(event.url, DEFAULT_LIMIT, MAX_LIMIT);
	// The counters and the stored keys describe every tenant, so the engine
	// serves them to a super admin only. A tenant admin's page is its own
	// rules and the providers, and never asks for the rest.
	const superAdmin = user?.roles?.includes('super_admin') ?? false;
	// The plugin flushes only the request's tenant whenever the request names
	// one. A session names its own tenant, and a tenant admin's session always
	// resolves to one. Only a super admin with no tenant of their own can reach
	// the whole store, and only on an install that keeps many tenants.
	const flushScoped = Boolean(sessionTenant(event)) || !superAdmin;

	const client = authedClient(event);
	// The shell says why the page is unavailable while its plugin does not run.
	const running = !notRunning(plugins, PLUGIN.cache);
	// The four reads are independent, so they start together. The counters and
	// the stored keys are a super admin's only.
	const [statsRead, providersRead, rulesRead, entriesRead] = running
		? await Promise.all([
				superAdmin ? section(readStats(client), couldNotLoad('the cache status')) : null,
				section(listProviders(client), couldNotLoad('providers')),
				section(listRules(client), couldNotLoad('response cache rules')),
				superAdmin ? section(listEntries(client, limit + 1, offset), couldNotLoad('stored entries')) : null,
			])
		: [null, null, null, null];
	const gate: Gate = !running ? { state: 'absent' } : statsRead && !statsRead.ok ? statsRead.gate : GATE_OK;
	const stats: CacheStats | null = statsRead?.ok ? statsRead.value : null;

	// Providers are the half the stats hide: a tripped backend leaves the hit
	// rate plausible because a lower-priority provider picks up. Losing this
	// read must not read as every provider being healthy.
	const unread = { rows: [] as CacheProvider[], read: false, licensed: null as boolean | null, inactive: [] as InactiveProvider[] };
	const providers: typeof unread & { gate: Gate | null } =
		gate.state !== 'ok' || !providersRead
			? { ...unread, gate: null }
			: providersRead.ok
				? {
						rows: rowsOf(providersRead.value),
						read: true,
						licensed: typeof providersRead.value?.licensed === 'boolean' ? providersRead.value.licensed : null,
						inactive: providersRead.value?.inactive ?? [],
						gate: null,
					}
				: { ...unread, gate: providersRead.gate };

	// The rules are the tenant's own and read on their own, so a refused or
	// failed read says so in their section and leaves the rest of the page.
	let rules: RulesState = { gate: { state: 'absent' }, rows: [], licensed: null, limit: undefined };
	if (gate.state === 'ok' && rulesRead) {
		rules = rulesRead.ok
			? {
					gate: { state: 'ok' },
					rows: rulesRead.value?.data ?? [],
					licensed: typeof rulesRead.value?.licensed === 'boolean' ? rulesRead.value.licensed : null,
					limit: rulesRead.value?.limits?.rules,
				}
			: { ...rules, gate: rulesRead.gate };
	}

	// A failed read of the stored keys keeps its reason. Drawn as no rows, it
	// said nothing is cached beside a counter of thousands of entries.
	let entries: { rows: CacheEntry[]; total: number | null; hasMore: boolean } = { rows: [], total: null, hasMore: false };
	let entriesGate: Gate | null = null;
	// A provider that cannot list what it holds answers an empty page with a
	// note. Drawn as an empty list, it said nothing is cached beside a counter
	// of thousands of entries.
	let unlisted = false;
	if (gate.state === 'ok' && entriesRead) {
		if (entriesRead.ok) {
			unlisted = typeof entriesRead.value?.note === 'string' && entriesRead.value.note !== '';
			entries = pageOf(entriesRead.value, limit, offset);
			const back = pastEndOffset(entries.rows.length, limit, offset, entries.total);
			if (back !== null) redirect(307, withOffset(event.url, back));
		} else {
			entriesGate = entriesRead.gate;
		}
	}

	return {
		superAdmin,
		stats,
		providers: providers.rows,
		providersRead: providers.read,
		providersGate: providers.gate,
		providersLicensed: providers.licensed,
		inactive: providers.inactive,
		rules,
		entries: entries.rows,
		entriesGate,
		unlisted,
		flushScoped,
		total: entries.total,
		limit,
		offset,
		hasMore: entries.hasMore,
		gate,
	};
};

/** Reads and checks the rule form. A string is the message for a refused one. */
function ruleBody(form: FormData) {
	const pattern = String(form.get('pattern') ?? '').trim();
	if (!patternIsSound(pattern)) {
		return 'Enter a path under /api/v1/, such as /api/v1/content/{schema} or /api/v1/content/posts/**. ** can only come last, and the path cannot include a query.';
	}
	const ttl = Math.floor(Number(form.get('ttl_seconds')));
	if (!Number.isFinite(ttl) || ttl < 1 || ttl > MAX_TTL_SECONDS) {
		return 'Enter a time to live of at least 1 second, as a whole number.';
	}
	const tags = parseTags(String(form.get('tags') ?? ''));
	if (tags.length > 32) return 'Enter at most 32 tags.';
	if (!tags.every(tagIsSound)) return 'Use 1 to 64 letters, digits, dots, dashes or underscores for each tag.';
	return { pattern, ttl_seconds: ttl, tags, enabled: form.get('enabled') === 'true' };
}

async function saveRule(event: Parameters<Actions[string]>[0], id: string | null) {
	await requireRole(event, ['admin', 'super_admin']);
	const client = authedClient(event);
	const form = await event.request.formData();
	const body = ruleBody(form);
	if (typeof body === 'string') return fail(400, { error: body, drawer: 'rule' });
	try {
		if (id) await updateRule(client, id, body);
		else await createRule(client, body);
	} catch (err) {
		const failed = actionFailure(err, 'Could not save the rule. Try again.');
		return fail(failed.status, { ...failed.data, drawer: 'rule' });
	}
	return { savedRule: body.pattern };
}

export const actions: Actions = {
	createRule: (event) => saveRule(event, null),

	updateRule: async (event) => {
		const form = await event.request.clone().formData();
		const id = String(form.get('id') ?? '');
		if (!id) return fail(400, { error: 'This form is missing its rule. Reload the page and try again.', drawer: 'rule' });
		return saveRule(event, id);
	},

	deleteRule: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		const client = authedClient(event);
		const form = await event.request.formData();
		const id = String(form.get('id') ?? '');
		if (!id) return fail(400, { error: 'This form is missing its rule. Reload the page and try again.' });
		try {
			await deleteRule(client, id);
		} catch (err) {
			return actionFailure(err, 'Could not delete the rule. Try again.');
		}
		return { removedRule: id };
	},

	// A purge evicts this tenant's cached responses only. Each one is
	// recomputed on its next request, which is the load the confirm names.
	purge: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		const client = authedClient(event);
		const form = await event.request.formData();
		const rule = String(form.get('rule') ?? '').trim();
		const tag = String(form.get('tag') ?? '').trim();
		if (tag && !tagIsSound(tag)) {
			return fail(400, { error: 'Use 1 to 64 letters, digits, dots, dashes or underscores for the tag.' });
		}
		try {
			const purged = rule ? await purgeRule(client, rule) : await purgeResponses(client, tag);
			return { purged, purgedWhat: rule ? 'rule' : tag ? `tag ${tag}` : 'all' };
		} catch (err) {
			return actionFailure(err, 'Could not purge the cached responses. Try again.');
		}
	},

	// Flushing is not a clearing convenience. Every flushed key is recomputed
	// on its next request, so this is a deliberate load against the database
	// and the page says so before it happens. The plugin admits a tenant admin
	// and scopes the flush to the tenant.
	flush: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		const client = authedClient(event);
		const form = await event.request.formData();
		const tag = String(form.get('tag') ?? '').trim();
		// The plugin scopes only a tenant tag to the tenant. Any other tag is
		// flushed from every tenant's entries, so it stays with a super admin.
		if (tag) await requireRole(event, ['super_admin']);
		try {
			if (tag) await flushTag(client, tag);
			else await flushAll(client);
		} catch (err) {
			return actionFailure(err, 'Could not flush the cache. Try again.');
		}
		return { flushed: tag || 'everything' };
	},

	resetCircuit: async (event) => {
		await requireRole(event, ['super_admin']);
		const client = authedClient(event);
		const form = await event.request.formData();
		const name = String(form.get('name') ?? '').trim();
		if (!name) return fail(400, { error: 'This form is missing its provider. Reload the page and try again.' });
		try {
			await resetCircuit(client, name);
		} catch (err) {
			return actionFailure(err, 'Could not reset the circuit. Try again.');
		}
		return { reset: name };
	},
};
