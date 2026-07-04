import type { PageServerLoad, Actions } from './$types';
import { fail } from '@sveltejs/kit';
import { authedClient, requireRole } from '$lib/server/authz';
import { actionError, actionFailure } from '$lib/server/action-error';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning } from '$lib/plugins';
import {
	CACHE_OK,
	cacheGate,
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
	type CacheGate,
	type CacheProvider,
	type CacheRule,
	type CacheStats,
	type InactiveProvider,
	type Limit,
} from '$lib/api/cache';
import { gateOf, type Gate } from '$lib/api/gate';
import { pageOf, pageWindow, rowsOf } from '$lib/api/list';

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

	const client = authedClient(event);
	let stats: CacheStats | null = null;
	// The shell says why the page is unavailable while its plugin does not run.
	let gate: CacheGate = notRunning(plugins, PLUGIN.cache) ? { state: 'absent' } : CACHE_OK;
	if (gate.state === 'ok' && superAdmin) {
		try {
			stats = await readStats(client);
		} catch (err) {
			gate = cacheGate(err);
		}
	}

	// Providers are the half the stats hide: a tripped backend leaves the hit
	// rate plausible because a lower-priority provider picks up. Losing this
	// read must not read as every provider being healthy.
	const providers =
		gate.state === 'ok'
			? await listProviders(client)
					.then((p) => ({
						rows: rowsOf(p),
						read: true,
						licensed: typeof p?.licensed === 'boolean' ? p.licensed : null,
						inactive: p?.inactive ?? [],
					}))
					.catch(() => ({ rows: [] as CacheProvider[], read: false, licensed: null, inactive: [] as InactiveProvider[] }))
			: { rows: [] as CacheProvider[], read: false, licensed: null, inactive: [] as InactiveProvider[] };

	// The rules are the tenant's own and read on their own, so a refused or
	// failed read says so in their section and leaves the rest of the page.
	let rules: RulesState = { gate: { state: 'absent' }, rows: [], licensed: null, limit: undefined };
	if (gate.state === 'ok') {
		try {
			const read = await listRules(client);
			rules = {
				gate: { state: 'ok' },
				rows: read?.data ?? [],
				licensed: typeof read?.licensed === 'boolean' ? read.licensed : null,
				limit: read?.limits?.rules,
			};
		} catch (err) {
			rules = {
				...rules,
				gate: gateOf(err, 'The response cache rules could not be read. This is not a report that there are none.'),
			};
		}
	}

	const entries =
		gate.state === 'ok' && superAdmin
			? await listEntries(client, limit + 1, offset)
					.then((p) => pageOf(p, limit, offset))
					.catch(() => ({ rows: [] as CacheEntry[], limit, offset, total: null, hasMore: false }))
			: { rows: [] as CacheEntry[], limit, offset, total: null, hasMore: false };

	return {
		superAdmin,
		stats,
		providers: providers.rows,
		providersRead: providers.read,
		providersLicensed: providers.licensed,
		inactive: providers.inactive,
		rules,
		entries: entries.rows,
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
		return 'A pattern is a path under /api/v1/ such as /api/v1/content/{schema} or /api/v1/content/posts/**. ** may only end it, and it carries no query.';
	}
	const ttl = Math.floor(Number(form.get('ttl_seconds')));
	if (!Number.isFinite(ttl) || ttl < 1 || ttl > MAX_TTL_SECONDS) {
		return 'The time to live is a whole number of seconds, at least one.';
	}
	const tags = parseTags(String(form.get('tags') ?? ''));
	if (tags.length > 32) return 'A rule carries at most 32 tags.';
	if (!tags.every(tagIsSound)) return 'Each tag is 1 to 64 letters, digits, dots, dashes or underscores.';
	return { pattern, ttl_seconds: ttl, tags, enabled: form.get('enabled') === 'true' };
}

async function saveRule(event: Parameters<Actions[string]>[0], id: string | null) {
	await requireRole(event, ['admin', 'super_admin']);
	const client = authedClient(event);
	const form = await event.request.formData();
	const body = ruleBody(form);
	if (typeof body === 'string') return fail(400, { error: body });
	try {
		if (id) await updateRule(client, id, body);
		else await createRule(client, body);
	} catch (err) {
		return actionFailure(err, 'The rule could not be saved.');
	}
	return { savedRule: body.pattern };
}

export const actions: Actions = {
	createRule: (event) => saveRule(event, null),

	updateRule: async (event) => {
		const form = await event.request.clone().formData();
		const id = String(form.get('id') ?? '');
		if (!id) return fail(400, { error: 'No rule was named.' });
		return saveRule(event, id);
	},

	deleteRule: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		const client = authedClient(event);
		const form = await event.request.formData();
		const id = String(form.get('id') ?? '');
		if (!id) return fail(400, { error: 'No rule was named.' });
		try {
			await deleteRule(client, id);
		} catch (err) {
			return actionFailure(err, 'The rule could not be deleted.');
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
			return fail(400, { error: 'A tag is 1 to 64 letters, digits, dots, dashes or underscores.' });
		}
		try {
			const purged = rule ? await purgeRule(client, rule) : await purgeResponses(client, tag);
			return { purged, purgedWhat: rule ? 'rule' : tag ? `tag ${tag}` : 'all' };
		} catch (err) {
			return actionFailure(err, 'The cached responses could not be purged.');
		}
	},

	// Flushing is not a clearing convenience. Every flushed key is recomputed
	// on its next request, so this is a deliberate load against the database
	// and the page says so before it happens.
	flush: async (event) => {
		await requireRole(event, ['super_admin']);
		const client = authedClient(event);
		const form = await event.request.formData();
		const tag = String(form.get('tag') ?? '').trim();
		try {
			if (tag) await flushTag(client, tag);
			else await flushAll(client);
		} catch (err) {
			return fail(400, { error: actionError(err, 'The cache could not be flushed.') });
		}
		return { flushed: tag || 'everything' };
	},

	resetCircuit: async (event) => {
		await requireRole(event, ['super_admin']);
		const client = authedClient(event);
		const form = await event.request.formData();
		const name = String(form.get('name') ?? '').trim();
		if (!name) return fail(400, { error: 'No provider was named.' });
		try {
			await resetCircuit(client, name);
		} catch (err) {
			return fail(400, { error: actionError(err, 'The circuit could not be reset.') });
		}
		return { reset: name };
	},
};
