import type { PageServerLoad, Actions } from './$types';
import { fail } from '@sveltejs/kit';
import { authedClient, requireRole } from '$lib/server/authz';
import { actionError } from '$lib/server/action-error';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning } from '$lib/plugins';
import {
	AB_OK,
	abGate,
	createExperiment,
	deleteExperiment,
	listExperiments,
	transition,
	updateExperiment,
	type AbGate,
	type Experiment,
	type Transition,
} from '$lib/api/ab-testing';
import { pageOf, pageWindow } from '$lib/api/list';

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const MOVES: readonly Transition[] = ['start', 'pause', 'resume', 'stop'];

/**
 * The significance threshold is a confidence level, which is how the engine
 * reads it: a variant is significant when its p-value is below one minus the
 * threshold, so 0.95 asks for p below 0.05. Below 0.5 a coin toss passes, and
 * at 1 nothing ever does. The engine takes the whole range, because a restore
 * writes back whatever was stored.
 */
const DEFAULT_CONFIDENCE = 0.95;
const MIN_CONFIDENCE = 0.5;
const MAX_CONFIDENCE = 0.999;

/** A field left empty takes the fallback. One that does not parse is NaN. */
function numberOr(raw: FormDataEntryValue | null, fallback: number): number {
	const text = String(raw ?? '').trim();
	return text === '' ? fallback : Number(text);
}

export const load: PageServerLoad = async (event) => {
	const { plugins } = await event.parent();
	const { limit, offset } = pageWindow(event.url, DEFAULT_LIMIT, MAX_LIMIT);

	// The shell says why the page is unavailable while its plugin does not run.
	if (notRunning(plugins, PLUGIN.abTesting)) {
		return {
			experiments: [] as Experiment[],
			total: null as number | null,
			limit,
			offset,
			hasMore: false,
			gate: { state: 'absent' } as AbGate,
		};
	}

	const client = authedClient(event);
	let experiments: Experiment[] = [];
	let total: number | null = null;
	let hasMore = false;
	let gate: AbGate = AB_OK;
	try {
		const page = pageOf(await listExperiments(client, limit + 1, offset), limit, offset);
		experiments = page.rows;
		total = page.total;
		hasMore = page.hasMore;
	} catch (err) {
		gate = abGate(err);
	}

	return { experiments, total, limit, offset, hasMore, gate };
};

async function save(event: Parameters<Actions[string]>[0], id: string | null) {
	await requireRole(event, ['admin', 'super_admin']);
	const client = authedClient(event);
	const form = await event.request.formData();

	const name = String(form.get('name') ?? '').trim();
	if (!name) return fail(400, { error: 'Name the experiment so a result can be attributed to it.' });

	const threshold = numberOr(form.get('significance_threshold'), DEFAULT_CONFIDENCE);
	if (!Number.isFinite(threshold) || threshold < MIN_CONFIDENCE || threshold > MAX_CONFIDENCE) {
		return fail(400, {
			error: `The significance threshold is a confidence level. Use a number from ${MIN_CONFIDENCE} to ${MAX_CONFIDENCE}, such as ${DEFAULT_CONFIDENCE}.`,
		});
	}

	const minSample = Math.floor(numberOr(form.get('min_sample_size'), 100));
	if (!Number.isFinite(minSample) || minSample < 1) {
		return fail(400, { error: 'The minimum sample size has to be at least one exposure.' });
	}

	const body = {
		name,
		description: String(form.get('description') ?? '').trim() || undefined,
		auto_stop_enabled: form.get('auto_stop_enabled') === 'true',
		significance_threshold: threshold,
		min_sample_size: minSample,
	};

	try {
		if (id) await updateExperiment(client, id, body);
		else await createExperiment(client, body);
	} catch (err) {
		return fail(400, { error: actionError(err, 'The experiment could not be saved.') });
	}
	return { saved: name };
}

export const actions: Actions = {
	create: (event) => save(event, null),

	update: async (event) => {
		const form = await event.request.clone().formData();
		const id = String(form.get('id') ?? '');
		if (!id) return fail(400, { error: 'No experiment was named.' });
		return save(event, id);
	},

	delete: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		const client = authedClient(event);
		const form = await event.request.formData();
		const id = String(form.get('id') ?? '');
		if (!id) return fail(400, { error: 'No experiment was named.' });
		try {
			await deleteExperiment(client, id);
		} catch (err) {
			return fail(400, { error: actionError(err, 'The experiment could not be removed.') });
		}
		return { removed: id };
	},

	// One action for all four moves. The engine decides whether a move is legal
	// and answers 409 naming both statuses when it is not, so the message it
	// sends is relayed rather than replaced: it says more than this side knows.
	move: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		const client = authedClient(event);
		const form = await event.request.formData();
		const id = String(form.get('id') ?? '');
		const move = String(form.get('move') ?? '') as Transition;
		if (!id) return fail(400, { error: 'No experiment was named.' });
		if (!MOVES.includes(move)) return fail(400, { error: 'That is not a move this experiment takes.' });
		try {
			await transition(client, id, move);
		} catch (err) {
			return fail(400, { error: actionError(err, 'The experiment could not be changed.') });
		}
		return { moved: move };
	},
};
