import { fail } from '@sveltejs/kit';
import type { FlowRefusal } from '$lib/api/flows';
import type { RefusalNotice } from '$lib/flow/types';

/**
 * What the page renders for a 402 the flow plugin answered, as the plugin
 * sent it.
 *
 * A refusal that carries a limit is the ceiling on flows, and the message
 * quotes the limit and the count the plugin sent. One that names nodes is a
 * definition using what this instance does not enable: the ids arrive as
 * problems, drawn on the canvas like a validation error. One that carries
 * neither refuses the flow routes as a whole, and the page says flows are not
 * enabled here.
 */
export function refusalFailure(err: FlowRefusal) {
	if (err.limit !== null) {
		return fail(402, {
			error: ceilingText(err.limit, err.current),
			refusal: { nodeIds: [], limit: err.limit, current: err.current } satisfies RefusalNotice,
		});
	}
	const nodeIds = err.nodeIds;
	if (nodeIds.length === 0) {
		return fail(402, { error: 'Flows are not enabled on this instance.', locked: true });
	}
	const named = nodeIds.map((id) => (id === 'trigger' ? 'the trigger' : id)).join(', ');
	return fail(402, {
		error: `${nodeIds.length === 1 ? 'One element uses' : `${nodeIds.length} elements use`} what this instance does not enable: ${named}.`,
		refusal: { nodeIds, limit: null, current: null } satisfies RefusalNotice,
		errors: err.errors,
	});
}

function ceilingText(limit: number, current: number | null): string {
	const held = current === null ? `This instance keeps at most ${limit} flows.` : `${current} of ${limit} flows are in use, the most this instance keeps.`;
	return `${held} Delete one to make room for another.`;
}
