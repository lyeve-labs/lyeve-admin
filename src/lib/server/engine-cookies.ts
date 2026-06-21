/**
 * Hands the browser the engine's CSRF cookie from a server-side call.
 *
 * SvelteKit applies the Set-Cookie headers of a server fetch only when the
 * request stays inside this app. `handleFetch` sends engine calls to
 * CORE_INTERNAL_URL instead, so without this the engine's CSRF cookie would
 * never reach the browser, and a browser-side write (a media upload) would
 * have no token to echo.
 *
 * Only the CSRF pair is relayed. The session cookie is the console's to write,
 * and nothing else the engine sets on these calls is meant for the browser.
 */
import type { Cookies } from '@sveltejs/kit';

const RELAYED = new Set(['__Host-csrf', 'csrf']);

type SameSite = 'strict' | 'lax' | 'none';

interface ParsedCookie {
	name: string;
	value: string;
	path: string;
	maxAge?: number;
	expires?: Date;
	httpOnly: boolean;
	secure: boolean;
	sameSite?: SameSite;
}

/** Parses one Set-Cookie header. Domain is dropped, so the cookie stays host-only. */
export function parseSetCookie(header: string): ParsedCookie | null {
	const [pair, ...attributes] = header.split(';');
	const eq = pair.indexOf('=');
	if (eq <= 0) return null;
	const cookie: ParsedCookie = {
		name: pair.slice(0, eq).trim(),
		value: pair.slice(eq + 1).trim(),
		path: '/',
		httpOnly: false,
		secure: false,
	};
	for (const attribute of attributes) {
		const [rawKey, ...rest] = attribute.split('=');
		const key = rawKey.trim().toLowerCase();
		const value = rest.join('=').trim();
		if (key === 'path' && value) cookie.path = value;
		else if (key === 'max-age' && /^-?\d+$/.test(value)) cookie.maxAge = Number(value);
		else if (key === 'expires' && !Number.isNaN(Date.parse(value))) cookie.expires = new Date(value);
		else if (key === 'httponly') cookie.httpOnly = true;
		else if (key === 'secure') cookie.secure = true;
		else if (key === 'samesite' && /^(strict|lax|none)$/i.test(value)) cookie.sameSite = value.toLowerCase() as SameSite;
	}
	return cookie;
}

/** Applies the engine's CSRF Set-Cookie headers to the browser's response. */
export function relayEngineCookies(headers: Headers, cookies: Cookies): void {
	for (const header of headers.getSetCookie()) {
		const cookie = parseSetCookie(header);
		if (!cookie || !RELAYED.has(cookie.name)) continue;
		const { name, value, ...options } = cookie;
		try {
			cookies.set(name, value, { ...options, encode: (v: string) => v });
		} catch {
			// A call that resolves after the response has started can no longer
			// set a cookie. The engine sets this one only on its auth calls, which
			// a page never streams, so skipping it loses nothing.
		}
	}
}
