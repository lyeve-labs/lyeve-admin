import { fail } from '@sveltejs/kit';
import { ApiError } from '@lyeve-labs/client';
import { refusalOf, refusalText } from '$lib/api/refusal';

/** Whether a status carries a message written for the operator. */
function isRelayable(status: number): boolean {
	return (status >= 400 && status < 500) || status === 501;
}

/**
 * Turns a thrown request error into a message worth showing the operator.
 *
 * A form action that ends in `catch { return fail(400, { error: 'Failed to
 * create X' }) }` throws away the only useful part of the response. The engine
 * answers a rejected write with a specific reason: "field_map is required and
 * must not be empty", "slug must match ^[a-z]...", "name already exists", and
 * without it the operator sees a form that looks correct and a banner that
 * does not say what to change.
 *
 * A 4xx body is a validation message about the request the operator just made,
 * so it is relayed. Most 5xx bodies can carry driver or infrastructure detail
 * that must not reach a response body, so those collapse to the caller's static
 * fallback.
 *
 * 501 is the exception: it is the engine deliberately stating that an operation
 * is not available on this instance ("this plugin does not expose its
 * migrations, so compatibility cannot be checked"). That sentence is written for
 * the operator, and swallowing it would leave them with "Compatibility check
 * failed" and no way to tell a real failure from an operation that was never
 * possible.
 */
export function actionError(err: unknown, fallback: string): string {
	if (err instanceof ApiError && isRelayable(err.status)) {
		const msg = err.message?.trim();
		if (msg && msg !== String(err.status)) return msg;
	}
	return fallback;
}

/**
 * The failure a form action returns for a thrown request error. A 402 is a
 * license refusal and returns 402 with the refusal beside its sentence, so
 * the page can render the numbers and the license link through
 * `RefusalNotice`. Anything else is `actionError` at `status`.
 */
export function actionFailure(err: unknown, fallback: string, status = 400) {
	const refused = refusalOf(err);
	if (refused) return fail(402, { error: refusalText(refused), refused });
	return fail(status, { error: actionError(err, fallback) });
}
