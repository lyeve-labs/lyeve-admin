/**
 * The admin session cookie, defined once so it is always read under the name
 * it was written with and cleared with the attributes it was set with.
 *
 * The engine names the cookie by the connection's scheme, and this follows it.
 * Over HTTPS it is `__Host-sys_session`: the prefix makes the browser refuse
 * the cookie unless it is Secure, host-only and scoped to /, so no other host
 * can plant or replace a session. The browser's own calls to the engine (a
 * media upload, the log stream) carry it, so the engine has to see the same
 * name the console writes. Over plain HTTP it is `sys_session`, because a
 * browser discards a `__Host-` cookie it cannot also mark Secure.
 *
 * Secure is explicit rather than inherited, because SvelteKit's guess from
 * the request scheme can emit a delete header the browser discards. The dead
 * session would then stay, and /login and the admin layout would redirect to
 * each other.
 */
import type { Cookies } from '@sveltejs/kit';

export const SESSION_COOKIE = '__Host-sys_session';
export const SESSION_COOKIE_INSECURE = 'sys_session';

/** The part of a request event that reading the session depends on. */
export interface SessionRead {
	cookies: Pick<Cookies, 'get'>;
	/** Absent only in a unit test's hand-built event, which reads as HTTPS. */
	url?: URL;
}

/** The part of a request event that writing the session depends on. */
export interface SessionEvent extends SessionRead {
	cookies: Cookies;
}

function isSecure(event: SessionRead): boolean {
	return event.url?.protocol !== 'http:';
}

/** The name the session cookie is written under for this request's scheme. */
export function sessionCookieName(event: SessionRead): string {
	return isSecure(event) ? SESSION_COOKIE : SESSION_COOKIE_INSECURE;
}

/**
 * The session token the browser presented, or undefined.
 *
 * Over HTTPS only the prefixed name counts: taking the plain one as well would
 * let any host able to set a cookie on the parent domain choose the session.
 * Over plain HTTP the plain name wins and the prefixed one still works, since
 * a browser keeps a `__Host-` cookie on a loopback origin.
 */
export function sessionToken(event: SessionRead): string | undefined {
	if (isSecure(event)) return event.cookies.get(SESSION_COOKIE) || undefined;
	return event.cookies.get(SESSION_COOKIE_INSECURE) || event.cookies.get(SESSION_COOKIE) || undefined;
}

function attrs(secure: boolean) {
	return { path: '/', httpOnly: true, secure, sameSite: 'strict' } as const;
}

export function setSessionCookie(event: SessionEvent, token: string): void {
	const secure = isSecure(event);
	event.cookies.set(sessionCookieName(event), token, { ...attrs(secure), maxAge: 86400 });
}

/**
 * Clears the session. Over plain HTTP the prefixed name goes too, or a cookie
 * left from an earlier sign-in would bring the session straight back.
 */
export function clearSessionCookie(event: SessionEvent): void {
	if (isSecure(event)) {
		event.cookies.delete(SESSION_COOKIE, attrs(true));
		return;
	}
	event.cookies.delete(SESSION_COOKIE_INSECURE, attrs(false));
	if (event.cookies.get(SESSION_COOKIE)) event.cookies.delete(SESSION_COOKIE, attrs(true));
}

/*
 * The refresh token the engine answers beside the session token on a password
 * or second-factor sign-in. It is the console's own cookie: the engine never
 * reads it, and the console trades it for a new session token before the old
 * one expires. Its name follows the scheme the way the session cookie's does.
 */
export const REFRESH_COOKIE = '__Host-console_refresh';
export const REFRESH_COOKIE_INSECURE = 'console_refresh';

/** The refresh token the browser presented, or undefined. Read like the session token. */
export function refreshToken(event: SessionRead): string | undefined {
	if (isSecure(event)) return event.cookies.get(REFRESH_COOKIE) || undefined;
	return event.cookies.get(REFRESH_COOKIE_INSECURE) || event.cookies.get(REFRESH_COOKIE) || undefined;
}

/**
 * Keeps the refresh token a sign-in answered. A sign-in that answered none
 * clears the cookie instead, so a refresh token left from an earlier session
 * can never renew this one.
 *
 * The engine keeps a refresh family for 30 days by default and does not say
 * when this token expires. The cookie lasts a day and is written again at
 * every trade, so it is a 24-hour idle limit inside the engine's own limit.
 */
export function setRefreshCookie(event: SessionEvent, token: string | undefined): void {
	if (!token) {
		clearRefreshCookie(event);
		return;
	}
	const secure = isSecure(event);
	event.cookies.set(secure ? REFRESH_COOKIE : REFRESH_COOKIE_INSECURE, token, { ...attrs(secure), maxAge: 86400 });
}

/** Clears the refresh token under both names, as `clearSessionCookie` does. */
export function clearRefreshCookie(event: SessionEvent): void {
	if (isSecure(event)) {
		event.cookies.delete(REFRESH_COOKIE, attrs(true));
		return;
	}
	event.cookies.delete(REFRESH_COOKIE_INSECURE, attrs(false));
	if (event.cookies.get(REFRESH_COOKIE)) event.cookies.delete(REFRESH_COOKIE, attrs(true));
}
