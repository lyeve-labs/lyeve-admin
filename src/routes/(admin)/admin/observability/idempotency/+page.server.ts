import type { PageServerLoad, Actions } from './$types';
import { fail } from '@sveltejs/kit';
import { authedClient, requireRole } from '$lib/server/authz';
import { actionError } from '$lib/server/action-error';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning } from '$lib/plugins';
import {
	IDEMPOTENCY_OK,
	idempotencyGate,
	listKeys,
	readStats,
	releaseKey,
	type IdempotencyGate,
	type IdempotencyKey,
	type IdempotencyStats,
} from '$lib/api/idempotency';
import { pageOf, pageWindow } from '$lib/api/list';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export const load: PageServerLoad = async (event) => {
	const { plugins } = await event.parent();
	const { limit, offset } = pageWindow(event.url, DEFAULT_LIMIT, MAX_LIMIT);

	const client = authedClient(event);
	let keys: IdempotencyKey[] = [];
	let total: number | null = null;
	let hasMore = false;
	// The shell says why the page is unavailable while its plugin does not run.
	let gate: IdempotencyGate = notRunning(plugins, PLUGIN.idempotency) ? { state: 'absent' } : IDEMPOTENCY_OK;
	if (gate.state === 'ok') {
		try {
			const page = pageOf(await listKeys(client, limit + 1, offset), limit, offset);
			keys = page.rows;
			total = page.total;
			hasMore = page.hasMore;
		} catch (err) {
			gate = idempotencyGate(err);
		}
	}

	// The counters cover every key, the list covers a page. Read separately so
	// a page of fifty cannot be mistaken for the whole store.
	const stats =
		gate.state === 'ok'
			? await readStats(client)
					.then((s) => ({ value: s, read: true }))
					.catch(() => ({ value: null as IdempotencyStats | null, read: false }))
			: { value: null as IdempotencyStats | null, read: false };

	return {
		keys,
		total,
		limit,
		offset,
		hasMore,
		stats: stats.value,
		statsRead: stats.read,
		gate,
	};
};

export const actions: Actions = {
	// Releasing a key lets the next request carrying it run the handler again,
	// which is the repair for a key whose process died mid-write and the wrong
	// thing to do to one that is genuinely in flight.
	release: async (event) => {
		await requireRole(event, ['super_admin']);
		const client = authedClient(event);
		const form = await event.request.formData();
		const key = String(form.get('key') ?? '');
		if (!key) return fail(400, { error: 'No key was named.' });
		try {
			await releaseKey(client, key);
		} catch (err) {
			return fail(400, { error: actionError(err, 'The key could not be released.') });
		}
		return { released: key };
	},
};
