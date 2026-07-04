import type { PageServerLoad, Actions } from './$types';
import { fail } from '@sveltejs/kit';
import { errorCodeOf } from '$lib/api/limits';
import { authedClient, requireRole } from '$lib/server/authz';
import { actionFailure } from '$lib/server/action-error';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning } from '$lib/plugins';
import {
	CAPTURE_OK,
	CONFIRM_WRITES,
	MAX_RETENTION_SECONDS,
	MAX_SET_CAPTURES,
	MIN_RETENTION_SECONDS,
	RULE_METHODS,
	captureGate,
	capturePatternIsSound,
	createCaptureRule,
	createReplaySet,
	deleteCaptureRule,
	deleteReplaySet,
	listCaptureRules,
	listCaptures,
	listReplaySets,
	replaySet,
	updateCaptureRule,
	type Capture,
	type CaptureGate,
	type CaptureRule,
	type ReplaySet,
	type RuleMethod,
} from '$lib/api/request-capture';
import { pageOf, pageWindow } from '$lib/api/list';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export const load: PageServerLoad = async (event) => {
	const { plugins } = await event.parent();
	const { limit, offset } = pageWindow(event.url, DEFAULT_LIMIT, MAX_LIMIT);
	const empty = {
		captures: [] as Capture[],
		total: null as number | null,
		limit,
		offset,
		hasMore: false,
		rules: [] as CaptureRule[],
		rulesRead: false,
		sets: [] as ReplaySet[],
		setsRead: false,
		licensed: null as boolean | null,
	};

	// The shell says why the page is unavailable while its plugin does not run.
	if (notRunning(plugins, PLUGIN.requestCapture)) {
		return { ...empty, gate: { state: 'absent' } as CaptureGate };
	}

	const client = authedClient(event);
	let gate: CaptureGate = CAPTURE_OK;
	let licensed: boolean | null = null;
	let page = { rows: [] as Capture[], total: null as number | null, hasMore: false };
	try {
		const read = await listCaptures(client, limit + 1, offset);
		const p = pageOf(read, limit, offset);
		page = { rows: p.rows, total: p.total, hasMore: p.hasMore };
		if (typeof read?.licensed === 'boolean') licensed = read.licensed;
	} catch (err) {
		gate = captureGate(err);
	}
	if (gate.state !== 'ok') return { ...empty, gate };

	// The rules and the sets are their own reads. Losing one says so in its
	// section and never reads as having none.
	const [rules, sets] = await Promise.all([
		listCaptureRules(client)
			.then((r) => ({ rows: r?.data ?? [], read: true, licensed: r?.licensed }))
			.catch(() => ({ rows: [] as CaptureRule[], read: false, licensed: undefined })),
		listReplaySets(client)
			.then((r) => ({ rows: r?.data ?? [], read: true }))
			.catch(() => ({ rows: [] as ReplaySet[], read: false })),
	]);
	if (licensed === null && typeof rules.licensed === 'boolean') licensed = rules.licensed;

	return {
		captures: page.rows,
		total: page.total,
		limit,
		offset,
		hasMore: page.hasMore,
		rules: rules.rows,
		rulesRead: rules.read,
		sets: sets.rows,
		setsRead: sets.read,
		licensed,
		gate,
	};
};

function method(raw: FormDataEntryValue | null): RuleMethod | null {
	const m = String(raw ?? '*').toUpperCase();
	return (RULE_METHODS as readonly string[]).includes(m) ? (m as RuleMethod) : null;
}

async function saveRule(event: Parameters<Actions[string]>[0], id: string | null) {
	await requireRole(event, ['admin', 'super_admin']);
	const client = authedClient(event);
	const form = await event.request.formData();

	const pattern = String(form.get('route_pattern') ?? '').trim();
	if (!capturePatternIsSound(pattern)) {
		return fail(400, {
			error: 'A route is an absolute path such as /api/v1/orders/{id} or /api/v1/**. A segment may be * or a {name}, and ** may only end it.',
		});
	}
	const m = method(form.get('method'));
	if (!m) return fail(400, { error: 'Choose a method, or every method.' });
	const percent = Number(form.get('sample_percent'));
	if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
		return fail(400, { error: 'The sample is a percentage from 0 to 100.' });
	}
	const retention = Math.floor(Number(form.get('retention_seconds')));
	if (!Number.isFinite(retention) || retention < MIN_RETENTION_SECONDS || retention > MAX_RETENTION_SECONDS) {
		return fail(400, { error: 'A capture is kept for at least an hour and at most 30 days.' });
	}

	const body = {
		route_pattern: pattern,
		method: m,
		sample_rate: Math.round(percent * 10) / 1000,
		retention_seconds: retention,
		enabled: form.get('enabled') === 'true',
	};
	try {
		if (id) await updateCaptureRule(client, id, body);
		else await createCaptureRule(client, body);
	} catch (err) {
		return actionFailure(err, 'The rule could not be saved.');
	}
	return { savedRule: pattern };
}

function idOf(form: FormData): string {
	return String(form.get('id') ?? '').trim();
}

export const actions: Actions = {
	createRule: (event) => saveRule(event, null),

	updateRule: async (event) => {
		const form = await event.request.clone().formData();
		if (!idOf(form)) return fail(400, { error: 'No rule was named.' });
		return saveRule(event, idOf(form));
	},

	deleteRule: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		const form = await event.request.formData();
		const id = idOf(form);
		if (!id) return fail(400, { error: 'No rule was named.' });
		try {
			await deleteCaptureRule(authedClient(event), id);
		} catch (err) {
			return actionFailure(err, 'The rule could not be deleted.');
		}
		return { removedRule: id };
	},

	createSet: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		const form = await event.request.formData();
		const name = String(form.get('name') ?? '').trim();
		const ids = [...new Set(form.getAll('capture_id').map((v) => String(v).trim()).filter(Boolean))];
		if (!name) return fail(400, { error: 'Name the set so a replay can say which one ran.' });
		if (ids.length === 0) return fail(400, { error: 'Select at least one capture.' });
		if (ids.length > MAX_SET_CAPTURES) {
			return fail(400, { error: `A set holds at most ${MAX_SET_CAPTURES} captures, because a replay runs them in one request.` });
		}
		try {
			await createReplaySet(authedClient(event), { name, capture_ids: ids });
		} catch (err) {
			return actionFailure(err, 'The replay set could not be created.');
		}
		return { savedSet: name };
	},

	deleteSet: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		const form = await event.request.formData();
		const id = idOf(form);
		if (!id) return fail(400, { error: 'No replay set was named.' });
		try {
			await deleteReplaySet(authedClient(event), id);
		} catch (err) {
			return actionFailure(err, 'The replay set could not be deleted.');
		}
		return { removedSet: id };
	},

	replaySet: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		const form = await event.request.formData();
		const id = idOf(form);
		if (!id) return fail(400, { error: 'No replay set was named.' });
		const writes = form.get('confirm_mutating') === 'true';
		try {
			const out = await replaySet(authedClient(event), id, writes);
			return { replay: out };
		} catch (err) {
			// The plugin refuses a set holding a write before any of it runs,
			// so asking again with the writes confirmed is safe.
			if (!writes && errorCodeOf(err) === CONFIRM_WRITES) {
				return fail(428, {
					error: 'This set holds a request that writes. Replaying it repeats the write.',
					needsWrites: id,
				});
			}
			return actionFailure(err, 'The replay set could not be replayed.');
		}
	},
};
