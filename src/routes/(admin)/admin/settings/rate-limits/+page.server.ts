import { readRouteOptions, routeOptions } from '$lib/api/route-options';
import type { PageServerLoad, Actions } from './$types';
import { fail } from '@sveltejs/kit';
import { authedClient, requireRole } from '$lib/server/authz';
import { actionError } from '$lib/server/action-error';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning } from '$lib/plugins';
import {
	RATE_LIMIT_OK,
	createRule,
	deleteRule,
	endpointIsSound,
	listRules,
	rateLimitGate,
	readOverview,
	readStatus,
	resetProtection,
	roleIsSound,
	setProtection,
	updateGlobal,
	updateRule,
	type LimiterState,
	type RateLimitGate,
	type RateLimitOverview,
	type RateRule,
} from '$lib/api/rate-limit';
import { pageOf, pageWindow, rowsOf } from '$lib/api/list';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/** The longest window a protection may take, in minutes: one day. */
const MAX_WINDOW_MINUTES = 1440;

function num(raw: FormDataEntryValue | null): number {
	const n = Number(raw);
	return Number.isFinite(n) ? n : Number.NaN;
}

export const load: PageServerLoad = async (event) => {
	const { plugins, user } = await event.parent();
	const { limit, offset } = pageWindow(event.url, DEFAULT_LIMIT, MAX_LIMIT);
	const superAdmin = user?.roles?.includes('super_admin') ?? false;

	const client = authedClient(event);
	let rules: RateRule[] = [];
	let total: number | null = null;
	let hasMore = false;
	// The shell says why the page is unavailable while its plugin does not run.
	let gate: RateLimitGate = notRunning(plugins, PLUGIN.rateLimit) ? { state: 'absent' } : RATE_LIMIT_OK;
	if (gate.state === 'ok') {
		try {
			// The global limit and the protections have sections of their own, so
			// the list, and its total, is the custom rules alone.
			const page = pageOf(await listRules(client, limit + 1, offset, 'custom'), limit, offset);
			rules = page.rows;
			total = page.total;
			hasMore = page.hasMore;
		} catch (err) {
			gate = rateLimitGate(err);
		}
	}

	// The overview says whether custom rules are enabled, which only the engine
	// can answer: a missing read is shown as unknown, never as locked or
	// unlocked.
	let overview: RateLimitOverview | null = null;
	if (gate.state === 'ok') {
		overview = await readOverview(client).catch(() => null);
	}

	// The live view is a snapshot from the process that answered, so losing it
	// must not lose the rules, and an unread one is never drawn as quiet.
	const status =
		gate.state === 'ok'
			? await readStatus(client)
					.then((r) => ({ rows: rowsOf(r), read: true }))
					.catch(() => ({ rows: [] as LimiterState[], read: false }))
			: { rows: [] as LimiterState[], read: false };

	// The routes the instance serves, to pick a rule's endpoint from. The
	// document is read as the caller: an admin gets the public routes, a super
	// admin every route. Missing, the field still takes a typed pattern.
	const routes = gate.state === 'ok' ? await readRouteOptions(client) : routeOptions(null);

	return {
		routes,
		rules,
		total,
		limit,
		offset,
		hasMore,
		overview,
		superAdmin,
		status: status.rows,
		statusRead: status.read,
		gate,
	};
};

async function save(event: Parameters<Actions[string]>[0], id: string | null) {
	const user = await requireRole(event, ['admin', 'super_admin']);
	const client = authedClient(event);
	const form = await event.request.formData();

	const endpoint = String(form.get('endpoint') ?? '').trim();
	if (!endpointIsSound(endpoint)) {
		return fail(400, {
			error: 'An endpoint is "*" for every request, or a method and a path such as GET /api/v1/content/{schema}. A segment may be a {name} placeholder and the last one may be *.',
		});
	}

	const rate = num(form.get('rate'));
	const burst = Math.floor(num(form.get('burst')));
	if (!Number.isFinite(rate) || rate <= 0) {
		return fail(400, { error: 'The rate is requests per second and must be more than zero.' });
	}
	if (!Number.isFinite(burst) || burst < 1) {
		return fail(400, { error: 'The burst is a number of requests and must be at least one.' });
	}

	const role = String(form.get('role') ?? '').trim();
	if (role && !roleIsSound(role)) {
		return fail(400, { error: 'A role is 1 to 64 letters, digits or _ . : -' });
	}
	const keyBy = form.get('key_by') === 'user' ? 'user' : 'ip';

	const body: Parameters<typeof createRule>[1] = {
		endpoint,
		rate,
		burst,
		enabled: form.get('enabled') === 'true',
		// An empty role clears it, so the rule applies to every caller.
		role: role || null,
		key_by: keyBy,
	};
	// Only a super_admin can place a rule on another tenant or on every
	// tenant. The engine files anyone else's rule under their own tenant
	// whatever the form says, so the field is neither shown nor sent.
	if (user.roles.includes('super_admin')) {
		const tenant = String(form.get('tenant_id') ?? '').trim();
		// An empty tenant means every tenant. Sent as null rather than "" so
		// the engine stores the scope the form actually showed.
		body.tenant_id = tenant || null;
	}

	try {
		if (id) await updateRule(client, id, body);
		else await createRule(client, body);
	} catch (err) {
		return fail(400, { error: actionError(err, 'The rule could not be saved.') });
	}
	return { saved: endpoint };
}

export const actions: Actions = {
	create: (event) => save(event, null),

	update: async (event) => {
		const form = await event.request.clone().formData();
		const id = String(form.get('id') ?? '');
		if (!id) return fail(400, { error: 'No rule was named.' });
		return save(event, id);
	},

	delete: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		const client = authedClient(event);
		const form = await event.request.formData();
		const id = String(form.get('id') ?? '');
		if (!id) return fail(400, { error: 'No rule was named.' });
		try {
			await deleteRule(client, id);
		} catch (err) {
			return fail(400, { error: actionError(err, 'The rule could not be removed.') });
		}
		return { removed: id };
	},

	global: async (event) => {
		await requireRole(event, ['super_admin']);
		const client = authedClient(event);
		const form = await event.request.formData();
		const rate = num(form.get('rate'));
		const burst = Math.floor(num(form.get('burst')));
		if (!Number.isFinite(rate) || rate <= 0) {
			return fail(400, { error: 'The rate is requests per second and must be more than zero.' });
		}
		if (!Number.isFinite(burst) || burst < 1) {
			return fail(400, { error: 'The burst must be at least one request.' });
		}
		try {
			await updateGlobal(client, { rate, burst, enabled: form.get('enabled') === 'true' });
		} catch (err) {
			return fail(400, { error: actionError(err, 'The global limit could not be saved.') });
		}
		return { savedGlobal: true };
	},

	protection: async (event) => {
		await requireRole(event, ['super_admin']);
		const client = authedClient(event);
		const form = await event.request.formData();
		const name = String(form.get('name') ?? '');
		const requests = Math.floor(num(form.get('requests')));
		const minutes = num(form.get('window_minutes'));
		if (!name) return fail(400, { error: 'No protection was named.' });
		if (!Number.isFinite(requests) || requests < 1 || requests > 100000) {
			return fail(400, {
				error: 'Requests must be between 1 and 100000. Zero would lock every caller out of signing in.',
			});
		}
		if (!Number.isFinite(minutes) || minutes <= 0 || minutes > MAX_WINDOW_MINUTES) {
			return fail(400, { error: 'The window is in minutes, more than zero and at most a day.' });
		}
		try {
			await setProtection(client, {
				name,
				requests,
				window_seconds: Math.max(1, Math.round(minutes * 60)),
			});
		} catch (err) {
			return fail(400, { error: actionError(err, 'The protection could not be saved.') });
		}
		return { savedProtection: name };
	},

	resetProtection: async (event) => {
		await requireRole(event, ['super_admin']);
		const client = authedClient(event);
		const form = await event.request.formData();
		const name = String(form.get('name') ?? '');
		if (!name) return fail(400, { error: 'No protection was named.' });
		try {
			await resetProtection(client, name);
		} catch (err) {
			return fail(400, { error: actionError(err, 'The protection could not be reset.') });
		}
		return { resetProtection: name };
	},
};
