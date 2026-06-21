import { ApiError } from '@lyeve-labs/client';

/**
 * The sentence a signed-out recovery page shows for an engine refusal that is
 * not about the visitor's input, or null when the refusal is the caller's to
 * explain.
 *
 * Magic links and password reset are plugins. An install that runs neither
 * has no route, so the engine answers 404 (or 405 when a neighboring method
 * exists), and a 402 means the plugin is loaded but not licensed to serve.
 * Either way the visitor needs to hear that this way in is closed, not that
 * they typed something wrong.
 */
export function recoveryRefusal(e: unknown, feature: string): { status: number; error: string } | null {
	if (!(e instanceof ApiError)) {
		return { status: 503, error: `${feature} is unavailable right now. Please try again shortly.` };
	}
	if (e.status === 404 || e.status === 405 || e.status === 402) {
		return { status: 404, error: `${feature} is not enabled on this instance. Ask an administrator to sign you in.` };
	}
	if (e.status === 429) {
		return { status: 429, error: 'Too many attempts. Please wait a few minutes and try again.' };
	}
	if (e.status >= 500) {
		return { status: e.status, error: `${feature} is unavailable right now. Please try again shortly.` };
	}
	return null;
}
