import { error, type RequestEvent } from '@sveltejs/kit';
import { createClient, type HttpClient } from '@lyeve-labs/client';
import { getMe } from '@lyeve-labs/client-rest';
import type { User } from '@lyeve-labs/client';
import { sessionToken } from '$lib/server/session-cookie';

// The engine's double-submit CSRF cookie, secure name first.
const CSRF_COOKIE = '__Host-csrf';
const CSRF_COOKIE_INSECURE = 'csrf';

/**
 * The headers a server-side request to the engine has to carry.
 *
 * This is the one place they are assembled. `event.fetch` forwards the
 * browser's cookies on a same-origin subrequest, so the engine sees its own
 * session cookie, switches from Bearer auth to cookie auth, and applies the
 * double-submit CSRF check whatever Authorization header the call also set.
 * A write without `X-CSRF-Token` is refused 403 "csrf token required", from
 * the route the caller was aiming at, so it reads as that route refusing it.
 *
 * Every call site that builds its own request has to come through here,
 * because the omission is invisible at the call site.
 *
 * The token is set only when a cookie is found: an empty header fails the
 * check it exists to pass.
 */
export function authedHeaders(event: RequestEvent): Record<string, string> {
	const token = sessionToken(event);
	if (!token) {
		error(401, 'Not authenticated');
	}
	const csrf = event.cookies.get(CSRF_COOKIE) ?? event.cookies.get(CSRF_COOKIE_INSECURE);
	return {
		Authorization: `Bearer ${token}`,
		...(csrf ? { 'X-CSRF-Token': csrf } : {}),
	};
}

/**
 * Build an API client authenticated as the current session.
 * Throws 401 if no session cookie is present. Use inside server load
 * functions and form actions where `await parent()` is unavailable.
 */
export function authedClient(event: RequestEvent): HttpClient {
	const headers = authedHeaders(event);
	return createClient((url, init) =>
		event.fetch(url, {
			...init,
			headers: { ...init?.headers, ...headers },
		})
	);
}

/** Require a valid session. Returns the authenticated user or throws 401. */
export async function requireUser(event: RequestEvent): Promise<User> {
	const user = await getMe(authedClient(event)).catch(() => null);
	if (!user) {
		error(401, 'Session invalid or expired');
	}
	return user;
}

/**
 * Require the session user to hold at least one of the given roles.
 * Throws 401 if unauthenticated, 403 if authenticated but unauthorized.
 *
 * Defense-in-depth: the Go backend is the authoritative authorization
 * boundary. This guards the UI's server actions so privileged operations
 * cannot be driven by a direct POST from a lower-privileged session.
 */
export async function requireRole(event: RequestEvent, roles: string[]): Promise<User> {
	const user = await requireUser(event);
	if (!roles.some((r) => user.roles.includes(r))) {
		error(403, `Requires one of roles: ${roles.join(', ')}`);
	}
	return user;
}

/**
 * Strip server-controlled / protected fields from a user-supplied content
 * payload to blunt mass-assignment. The backend remains authoritative
 * for per-field write ACLs. This removes the obvious privilege fields a
 * crafted form could otherwise inject.
 */
const PROTECTED_FIELDS = new Set([
	'id',
	'_id',
	'_status',
	'status',
	'created_by',
	'updated_by',
	'created_at',
	'updated_at',
	'tenant_id',
	'system',
]);

export function stripProtectedFields(data: Record<string, unknown>): Record<string, unknown> {
	return Object.fromEntries(Object.entries(data).filter(([k]) => !PROTECTED_FIELDS.has(k)));
}
