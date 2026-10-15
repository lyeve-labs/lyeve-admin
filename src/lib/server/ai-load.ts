/**
 * What a refused AI read means for the page, sorted by status.
 *
 * The plugin refuses in four distinct ways and each wants different words. A
 * 402 is the feature not enabled, which the locked state already paints, or a
 * spent monthly budget, which only a write can meet. A 403
 * is a role that may not read the resource. A 404 is the tenant's own switch:
 * every route but the settings pair answers it while the switch is off, and the
 * way back is that switch. A 503 that says no provider is enabled is the
 * plugin with nothing to answer through. A 401 is an expired
 * session and goes where the shell sends one. Everything else keeps the engine
 * banner, which is not a report that there is nothing.
 */

import { redirect } from '@sveltejs/kit';
import { ApiError } from '@lyeve-labs/client';
import { clearSessionCookie, type SessionEvent } from './session-cookie';
import { AI_OK, type AiGate } from '$lib/api/ai';

export { AI_OK, type AiGate };

/** The static engine banner for one resource, named in the plural. */
export function aiBanner(plural: string): string {
	const Plural = plural.charAt(0).toUpperCase() + plural.slice(1);
	return `${Plural} could not be read from the engine. This is not a report that there are none.`;
}

export function aiGate(err: unknown, session: SessionEvent, plural: string): AiGate {
	return sortGate(err, session, plural, 'off');
}

/**
 * The settings read is the one route the tenant switch leaves open, so a 404
 * there is the plugin missing from the instance, not the tenant's switch.
 */
export function aiSettingsGate(err: unknown, session: SessionEvent): AiGate {
	return sortGate(err, session, 'AI settings', 'absent');
}

function sortGate(err: unknown, session: SessionEvent, plural: string, notFound: 'off' | 'absent'): AiGate {
	if (err instanceof ApiError) {
		if (err.status === 401) {
			clearSessionCookie(session);
			redirect(302, '/login');
		}
		if (err.status === 402) return { state: 'locked' };
		if (err.status === 403) return { state: 'forbidden' };
		if (err.status === 404) return { state: notFound };
		if (noProvider(err)) return { state: 'no_provider' };
	}
	return { state: 'error', message: aiBanner(plural) };
}

/**
 * Whether a refusal is the plugin having no enabled provider. The plugin
 * answers that with a 503 and one sentence, under the generic code every 503
 * carries. Its store failures and a proxy's error page are 503s too, and both
 * are an outage, so the sentence decides.
 */
function noProvider(err: ApiError): boolean {
	const said = (err.body as { error?: unknown } | null | undefined)?.error;
	return err.status === 503 && typeof said === 'string' && said.trim().toLowerCase() === 'no enabled ai provider configured';
}

/** What the reader sees when a provider's monthly budget is spent. */
export const AI_BUDGET_TEXT =
	'The AI budget for this billing period is spent. Raise a provider\'s monthly budget, or wait for the next period.';

/**
 * Whether a 402 is the spent budget rather than the license. The plugin
 * answers both with 402. The budget refusal is the one sentence that names
 * the budget ("ai budget exhausted for this billing period"), so that word
 * decides. Every other 402, a ceiling included, is read as the license, the
 * state a 402 always meant here.
 */
export function aiBudgetSpent(err: unknown): boolean {
	if (!(err instanceof ApiError) || err.status !== 402) return false;
	const said = (err.body as { error?: unknown } | null | undefined)?.error;
	return typeof said === 'string' && /\bbudget\b/i.test(said);
}

/** The lowest role a refused route admits, which is who the reader can ask. */
export type AiWriteRole = 'admin' | 'super_admin';

const ROLE_TEXT: Record<AiWriteRole, string> = {
	admin: 'Your role cannot change this. Ask an admin if you need it.',
	super_admin: 'Your role cannot change this. Ask a super admin if you need it.',
};

/**
 * Words for a refused write, by status. The static fallback for the rest.
 * `lowest` is the lowest role the route admits, which a role refusal names.
 */
export function aiActionError(err: unknown, fallback: string, lowest: AiWriteRole = 'admin'): string {
	if (err instanceof ApiError) {
		if (aiBudgetSpent(err)) return AI_BUDGET_TEXT;
		if (err.status === 402) return 'AI is not enabled on this instance.';
		if (err.status === 403) {
			// The engine's role gate answers a bare "insufficient permissions".
			// The plugin's own 403 is a sentence about the tenant, worth relaying.
			const msg = err.message?.trim();
			if (!msg || msg === 'insufficient permissions' || msg === '403') return ROLE_TEXT[lowest];
			return msg;
		}
		if (err.status === 404) return 'AI is switched off for this tenant.';
		if (noProvider(err)) return 'No enabled AI provider can answer this. Add or enable a provider first.';
		if (err.status === 409) return 'No configured provider supports this operation.';
		if (err.status >= 400 && err.status < 500) {
			const msg = err.message?.trim();
			if (msg && msg !== String(err.status)) return msg;
		}
	}
	return fallback;
}
