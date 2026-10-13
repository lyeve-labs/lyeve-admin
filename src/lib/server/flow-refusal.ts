import { fail } from '@sveltejs/kit';
import type { FlowRefusal } from '$lib/api/flows';
import type { RefusalNotice } from '$lib/flow/types';
import { notEnabledText } from '$lib/flow/blocked';

/**
 * What the page renders for a 402 the flow plugin answered, as the plugin
 * sent it.
 *
 * A refusal that carries a limit is the ceiling on flows, and the message
 * quotes the limit and the count the plugin sent, then the way forward: a
 * license that allows more, before deleting one. One that names nodes is a
 * definition using what this instance does not enable: the ids arrive as
 * problems, drawn on the canvas like a validation error. One that carries
 * neither refuses the flow routes as a whole, and the page says flows are not
 * enabled here.
 */
export function refusalFailure(err: FlowRefusal) {
	if (err.limit !== null) {
		return fail(402, {
			error: ceilingText(err.limit, err.current),
			refusal: { nodeIds: [], limit: err.limit, current: err.current, upgradeUrl: err.upgradeUrl } satisfies RefusalNotice,
		});
	}
	const nodeIds = err.nodeIds;
	if (nodeIds.length === 0) {
		return fail(402, { error: notEnabledText(nodeIds), locked: true });
	}
	return fail(402, {
		error: notEnabledText(nodeIds),
		refusal: { nodeIds, limit: null, current: null, upgradeUrl: err.upgradeUrl } satisfies RefusalNotice,
		errors: err.errors,
	});
}

function ceilingText(limit: number, current: number | null): string {
	const held = current === null ? `This instance keeps at most ${limit} flows.` : `${current} of ${limit} flows are in use, the most this instance keeps.`;
	return `${held} Add more with a license, or delete one to make room.`;
}
