/**
 * What a refused flow read means for the page, sorted by status.
 *
 * A 401 is an expired session and goes where the
 * shell sends one: the cookie is cleared and the reader lands on the login
 * page, exactly as the admin layout does. A 403 is a role that may not read
 * the resource and says so. A 402 is the locked state the page already paints.
 * Everything else, a 5xx, a network failure or a status nothing here expects,
 * keeps the engine banner, which is not a report that there are none.
 */

import { redirect } from '@sveltejs/kit';
import { ApiError } from '@lyeve-labs/client';
import { clearSessionCookie, type SessionEvent } from './session-cookie';

export type LoadOutcome = { locked: boolean; loadError: string | null };

/** The static engine banner for one resource, named in the plural. */
export function engineBanner(plural: string): string {
	const Plural = plural.charAt(0).toUpperCase() + plural.slice(1);
	return `${Plural} could not be read from the engine. This is not a report that there are none.`;
}

export function flowLoadOutcome(err: unknown, session: SessionEvent, plural: string): LoadOutcome {
	if (err instanceof ApiError) {
		if (err.status === 401) {
			clearSessionCookie(session);
			redirect(302, '/login');
		}
		if (err.status === 402) return { locked: true, loadError: null };
		if (err.status === 403) return { locked: false, loadError: `Your role cannot read ${plural}.` };
	}
	return { locked: false, loadError: engineBanner(plural) };
}
