import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Cookies, RequestEvent } from '@sveltejs/kit';
// SvelteKit's own request cookie jar, so the tests read a cookie back the way
// a load does after this step set it.
// @ts-expect-error SvelteKit ships this module without type declarations.
import { get_cookies } from '../../../node_modules/@sveltejs/kit/src/runtime/server/cookie.js';
import { authedHeaders } from '$lib/server/authz';
import { refreshSession, needsRefresh, resetSessionRefresh } from './session-refresh';

const NOW = Date.parse('2026-10-14T12:00:00Z');

/** An unsigned token with the claims this step reads. The engine checks signatures, this step does not. */
function jwt(claims: { exp: number; sub?: string }): string {
	const part = (v: object) => Buffer.from(JSON.stringify(v)).toString('base64url');
	return `${part({ alg: 'HS256', typ: 'JWT' })}.${part({ sub: 'user-1', ...claims })}.signature`;
}

const secs = (ms: number) => Math.floor(ms / 1000);
const FRESH = jwt({ exp: secs(NOW) + 600 });
const CLOSE = jwt({ exp: secs(NOW) + 90 });
const EXPIRED = jwt({ exp: secs(NOW) - 30 });
const RENEWED = jwt({ exp: secs(NOW) + 900 });

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function renewing(token = RENEWED, refresh = 'refresh-2') {
	return vi.fn(async () => json({ token, refresh_token: refresh, csrf_token: 'c', expires_in: 900 }));
}

/** A request event over HTTPS whose cookies behave as SvelteKit's do inside handle. */
function event(path: string, cookies: Record<string, string>, fetch: typeof globalThis.fetch): RequestEvent {
	const url = new URL(`https://admin.example.com${path}`);
	const header = Object.entries(cookies)
		.map(([name, value]) => `${name}=${value}`)
		.join('; ');
	const request = new Request(url, { headers: header ? { cookie: header } : {} });
	const jar = get_cookies(request, url);
	jar.set_trailing_slash('never');
	return { url, request, fetch, cookies: jar.cookies as Cookies } as unknown as RequestEvent;
}

function signedIn(token: string, fetch: typeof globalThis.fetch, path = '/admin/users') {
	return event(path, { '__Host-sys_session': token, '__Host-console_refresh': 'refresh-1' }, fetch);
}

async function redirectOf(fn: () => Promise<unknown>): Promise<{ status: number; location: string } | null> {
	try {
		await fn();
		return null;
	} catch (e) {
		const r = e as { status?: number; location?: string };
		if (r.status && r.location) return { status: r.status, location: r.location };
		throw e;
	}
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(NOW);
	resetSessionRefresh();
});

afterEach(() => {
	vi.useRealTimers();
});

describe('when the session token is traded', () => {
	it('waits while more than two minutes are left', () => {
		expect(needsRefresh(FRESH, NOW)).toBe(false);
		expect(needsRefresh(jwt({ exp: secs(NOW) + 121 }), NOW)).toBe(false);
	});

	it('trades a token with under two minutes left, or one already expired', () => {
		expect(needsRefresh(CLOSE, NOW)).toBe(true);
		expect(needsRefresh(EXPIRED, NOW)).toBe(true);
	});

	it('leaves a token with no readable expiry to the engine', () => {
		expect(needsRefresh('not-a-jwt', NOW)).toBe(false);
		expect(needsRefresh('a.b.c', NOW)).toBe(false);
	});

	it('does not call the engine for a token with time left', async () => {
		const fetch = renewing();
		await refreshSession(signedIn(FRESH, fetch));
		expect(fetch).not.toHaveBeenCalled();
	});

	it('does nothing without a refresh token, as after a provider sign-in', async () => {
		const fetch = renewing();
		const e = event('/admin/users', { '__Host-sys_session': EXPIRED }, fetch);
		await refreshSession(e);
		expect(fetch).not.toHaveBeenCalled();
		expect(e.cookies.get('__Host-sys_session')).toBe(EXPIRED);
	});
});

describe('a renewed session', () => {
	it('sends the refresh token and writes both new cookies', async () => {
		const fetch = renewing();
		const e = signedIn(CLOSE, fetch);
		await refreshSession(e);

		expect(fetch).toHaveBeenCalledTimes(1);
		const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe('/api/admin/auth/refresh');
		expect(init.method).toBe('POST');
		expect(JSON.parse(String(init.body))).toEqual({ refresh_token: 'refresh-1' });
		expect(e.cookies.get('__Host-sys_session')).toBe(RENEWED);
		expect(e.cookies.get('__Host-console_refresh')).toBe('refresh-2');
	});

	it('reaches every load and action later in the same request', async () => {
		const e = signedIn(EXPIRED, renewing());
		await refreshSession(e);
		expect(authedHeaders(e).Authorization).toBe(`Bearer ${RENEWED}`);
	});

	it('is not taken over by a refresh token left from another account', async () => {
		const fetch = renewing(jwt({ exp: secs(NOW) + 900, sub: 'user-2' }));
		const e = signedIn(CLOSE, fetch);
		await refreshSession(e);
		expect(e.cookies.get('__Host-sys_session')).toBe(CLOSE);
		expect(e.cookies.get('__Host-console_refresh')).toBeUndefined();
	});
});

describe('one trade per refresh token', () => {
	it('runs once for requests sent at the same time', async () => {
		const pending: ((r: Response) => void)[] = [];
		const fetch = vi.fn(() => new Promise<Response>((resolve) => pending.push(resolve)));
		const first = signedIn(CLOSE, fetch);
		const second = signedIn(CLOSE, fetch);

		const both = Promise.all([refreshSession(first), refreshSession(second)]);
		for (const answer of pending) answer(json({ token: RENEWED, refresh_token: 'refresh-2' }));
		await both;

		expect(fetch).toHaveBeenCalledTimes(1);
		expect(second.cookies.get('__Host-sys_session')).toBe(RENEWED);
		expect(second.cookies.get('__Host-console_refresh')).toBe('refresh-2');
	});

	it('serves the answer for a minute to a request that still carries the old cookie', async () => {
		const fetch = renewing();
		await refreshSession(signedIn(CLOSE, fetch));

		vi.setSystemTime(NOW + 59_000);
		const late = signedIn(CLOSE, fetch);
		await refreshSession(late);
		expect(fetch).toHaveBeenCalledTimes(1);
		expect(late.cookies.get('__Host-sys_session')).toBe(RENEWED);

		vi.setSystemTime(NOW + 61_000);
		await refreshSession(signedIn(CLOSE, fetch));
		expect(fetch).toHaveBeenCalledTimes(2);
	});
});

describe('a refused refresh', () => {
	it('clears both cookies and sends an admin page to the sign-in notice', async () => {
		const fetch = vi.fn(async () => json({ error: 'session revoked' }, 401));
		const e = signedIn(CLOSE, fetch);

		const r = await redirectOf(() => refreshSession(e));

		expect(r).toEqual({ status: 303, location: '/login?ended=1' });
		expect(e.cookies.get('__Host-sys_session')).toBeUndefined();
		expect(e.cookies.get('__Host-console_refresh')).toBeUndefined();
	});

	it('clears both cookies and lets the sign-in page itself render', async () => {
		const fetch = vi.fn(async () => json({ error: 'session revoked' }, 401));
		const e = signedIn(EXPIRED, fetch, '/login');

		expect(await redirectOf(() => refreshSession(e))).toBeNull();
		expect(e.cookies.get('__Host-sys_session')).toBeUndefined();
		expect(e.cookies.get('__Host-console_refresh')).toBeUndefined();
	});
});

describe('an engine that cannot answer', () => {
	it.each([
		['a 503', async () => json({ error: 'session store unavailable' }, 503)],
		['a 429', async () => json({ error: 'rate limited' }, 429)],
		['no answer', async () => Promise.reject(new TypeError('fetch failed'))],
	])('keeps the cookies and lets the request through on %s', async (_name, answer) => {
		const fetch = vi.fn(answer);
		const e = signedIn(EXPIRED, fetch as unknown as typeof globalThis.fetch);

		expect(await redirectOf(() => refreshSession(e))).toBeNull();
		expect(e.cookies.get('__Host-sys_session')).toBe(EXPIRED);
		expect(e.cookies.get('__Host-console_refresh')).toBe('refresh-1');
	});

	it('is asked again on the next request', async () => {
		const fetch = vi.fn(async () => json({ error: 'unavailable' }, 503));
		await refreshSession(signedIn(EXPIRED, fetch));
		await refreshSession(signedIn(EXPIRED, fetch));
		expect(fetch).toHaveBeenCalledTimes(2);
	});
});
