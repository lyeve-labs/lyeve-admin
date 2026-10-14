/**
 * Keeps a console session alive past the engine's session token.
 *
 * The engine signs a session token that lives a few minutes and answers a
 * refresh token beside it on a password or second-factor sign-in. Before a
 * request reaches a load or an action, a session token with under two minutes
 * left is traded for a new pair and both cookies are rewritten. SvelteKit
 * reads a cookie set during a request back from that request, so every load
 * and action after this step sends the new token.
 *
 * The engine rotates the refresh token on every trade and reads a second use
 * of a rotated one as theft: it revokes the whole family, which signs the
 * person out. A page sends several requests at once, and the browser can send
 * one with the old cookie after another request rotated it. So one trade runs
 * per refresh token in this process, and its answer stays here under the old
 * token for a minute, for every request that still carries it.
 *
 * A sign-in through a provider or an emailed link answers no refresh token,
 * so those sessions still end when their token does.
 */
import { redirect, type RequestEvent } from '@sveltejs/kit';
import {
	clearRefreshCookie,
	clearSessionCookie,
	refreshToken,
	sessionToken,
	setRefreshCookie,
	setSessionCookie,
} from '$lib/server/session-cookie';

/** How long before its expiry a session token is traded. */
const AHEAD_MS = 2 * 60 * 1000;
/** How long a trade's answer is served to requests that carry the old refresh token. */
const KEEP_MS = 60 * 1000;
/** The most answers kept at once. The oldest go first. */
const KEPT_MAX = 10_000;

/** Where the sign-in page says the session ended. */
export const SESSION_ENDED = '/login?ended=1';

export type Trade =
	| { kind: 'renewed'; token: string; refreshToken: string }
	| { kind: 'refused' }
	| { kind: 'unavailable' };

const running = new Map<string, Promise<Trade>>();
const kept = new Map<string, { trade: Trade; until: number }>();

/** Forgets every trade, for a test that needs a fresh process. */
export function resetSessionRefresh(): void {
	running.clear();
	kept.clear();
}

/**
 * The token's claims, read without checking its signature. The engine checks
 * it on every call, so this only decides when to ask for a new one.
 */
function claims(token: string): { exp?: unknown; sub?: unknown } | null {
	const payload = token.split('.')[1];
	if (!payload) return null;
	try {
		const parsed: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
		return parsed && typeof parsed === 'object' ? parsed : null;
	} catch {
		return null;
	}
}

/** Whether the token has expired or has under two minutes left. A token with no readable expiry is left to the engine. */
export function needsRefresh(token: string, now = Date.now()): boolean {
	const exp = claims(token)?.exp;
	return typeof exp === 'number' && exp * 1000 - now < AHEAD_MS;
}

async function trade(refresh: string, fetch: typeof globalThis.fetch): Promise<Trade> {
	let res: Response;
	try {
		res = await fetch('/api/admin/auth/refresh', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ refresh_token: refresh }),
		});
	} catch {
		return { kind: 'unavailable' };
	}
	// Only a 401 says the family is over: revoked by a sign-out, a password
	// set or a disable, or past its own lifetime. A 503 is the engine asking
	// to be asked again, and a 429 is the rate limit.
	if (res.status === 401) return { kind: 'refused' };
	if (!res.ok) return { kind: 'unavailable' };
	const body = (await res.json().catch(() => null)) as { token?: unknown; refresh_token?: unknown } | null;
	if (typeof body?.token !== 'string' || typeof body.refresh_token !== 'string') return { kind: 'unavailable' };
	return { kind: 'renewed', token: body.token, refreshToken: body.refresh_token };
}

function keep(refresh: string, result: Trade): void {
	const now = Date.now();
	for (const [key, entry] of kept) {
		if (entry.until > now && kept.size < KEPT_MAX) break;
		kept.delete(key);
	}
	kept.set(refresh, { trade: result, until: now + KEEP_MS });
}

/**
 * The answer for this refresh token: a kept one, the trade already running,
 * or a new trade. An outage is not kept, so the next request asks again.
 */
export function tradeOnce(refresh: string, fetch: typeof globalThis.fetch): Promise<Trade> {
	const hit = kept.get(refresh);
	if (hit && hit.until > Date.now()) return Promise.resolve(hit.trade);
	const inFlight = running.get(refresh);
	if (inFlight) return inFlight;
	const started = trade(refresh, fetch).then((result) => {
		running.delete(refresh);
		if (result.kind !== 'unavailable') keep(refresh, result);
		return result;
	});
	running.set(refresh, started);
	return started;
}

/**
 * Renews the session when its token is close to expiry. An engine that refused
 * the refresh token ends the session, and an admin page then goes to the
 * sign-in page, which says so. An engine that did not answer changes nothing:
 * the request goes on with the cookies it brought, and the outage shows the
 * way it shows on any page.
 */
export async function refreshSession(event: RequestEvent): Promise<void> {
	const refresh = refreshToken(event);
	if (!refresh) return;
	const current = sessionToken(event);
	if (current && !needsRefresh(current)) return;

	const result = await tradeOnce(refresh, event.fetch);
	if (result.kind === 'unavailable') return;
	if (result.kind === 'renewed') {
		// A session cookie written by a later sign-in for another account wins
		// over a refresh token left from the earlier one.
		if (current && claims(current)?.sub !== claims(result.token)?.sub) {
			clearRefreshCookie(event);
			return;
		}
		setSessionCookie(event, result.token);
		setRefreshCookie(event, result.refreshToken);
		return;
	}
	clearSessionCookie(event);
	clearRefreshCookie(event);
	if (event.url.pathname === '/admin' || event.url.pathname.startsWith('/admin/')) {
		redirect(303, SESSION_ENDED);
	}
}
