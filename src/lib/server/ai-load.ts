/**
 * What a refused AI read means for the page, sorted by status.
 *
 * The plugin refuses in four distinct ways and each wants different words. A
 * 402 is the feature not enabled, which the locked state already paints. A 403
 * is a role that may not read the resource. A 404 is the tenant's own switch:
 * every route but the settings pair answers it while the switch is off, and the
 * way back is that switch. A 503 is the plugin with nothing to answer through:
 * no enabled provider, or a store that did not answer. A 401 is an expired
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
		if (err.status === 503) return { state: 'no_provider' };
	}
	return { state: 'error', message: aiBanner(plural) };
}

/** Words for a refused write, by status. The static fallback for the rest. */
export function aiActionError(err: unknown, fallback: string): string {
	if (err instanceof ApiError) {
		if (err.status === 402) return 'AI is not enabled on this instance.';
		if (err.status === 403) return err.message?.trim() || 'Your role cannot do this.';
		if (err.status === 404) return 'AI is switched off for this tenant.';
		if (err.status === 503) return 'No enabled AI provider can answer this. Add or enable a provider first.';
		if (err.status === 409) return 'No configured provider supports this operation.';
		if (err.status >= 400 && err.status < 500) {
			const msg = err.message?.trim();
			if (msg && msg !== String(err.status)) return msg;
		}
	}
	return fallback;
}
