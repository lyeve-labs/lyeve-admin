/**
 * What a plugin's page makes of a refused read, the same way for every
 * plugin.
 *
 * A page never knows how its plugin is licensed or which capability a route
 * needs. It knows what the engine answered:
 *
 *   404  the route is not there: the plugin is not in this build, or does not
 *        serve it.
 *   402  the engine refused what this instance is not enabled for. A capacity
 *        refusal says `cap_exceeded` and carries the ceiling and the count, so
 *        a page never holds either number itself.
 *   else the read failed, and a failed read is never a report that there is
 *        nothing to show.
 */
import { ApiError } from '@lyeve-labs/client';

export type Gate =
	| { state: 'ok' }
	| { state: 'absent' }
	/** Not enabled on this instance. The link is where it is turned on, when the engine names one. */
	| { state: 'locked'; upgradeUrl: string }
	/** At a capacity ceiling. Either number is null when the engine did not send it. */
	| { state: 'full'; limit: number | null; current: number | null; upgradeUrl: string }
	| { state: 'error'; message: string };

export const GATE_OK: Gate = { state: 'ok' };

/** What a 402 carries, as far as a page reads it. */
interface Refusal {
	error?: unknown;
	limit?: unknown;
	current?: unknown;
	upgrade_url?: unknown;
}

function count(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function text(value: unknown): string {
	return typeof value === 'string' ? value : '';
}

/**
 * The gate for a read that threw. `failed` is what the page says when the
 * read failed, in words that never pass the failure off as an empty result.
 */
export function gateOf(err: unknown, failed: string): Gate {
	if (err instanceof ApiError) {
		if (err.status === 404) return { state: 'absent' };
		if (err.status === 402) {
			const body = (err.body ?? {}) as Refusal;
			const upgradeUrl = text(body.upgrade_url);
			if (body.error === 'cap_exceeded') {
				return { state: 'full', limit: count(body.limit), current: count(body.current), upgradeUrl };
			}
			return { state: 'locked', upgradeUrl };
		}
	}
	return { state: 'error', message: failed };
}

/** The sentence a page shows for a gate at a ceiling. */
export function fullText(gate: Extract<Gate, { state: 'full' }>): string {
	if (gate.limit !== null && gate.current !== null) {
		return `${gate.current} of ${gate.limit} are in use, which is the most this instance allows.`;
	}
	if (gate.limit !== null) return `This instance allows at most ${gate.limit}.`;
	return 'This instance allows no more.';
}
