/**
 * CSRF header for browser-side calls to the engine.
 *
 * The engine enforces the double-submit pattern on any cookie-authenticated
 * write: a request carrying its session cookie must echo the CSRF cookie in
 * `X-CSRF-Token` or it is refused with 403 "csrf token required". A `fetch`
 * from a component script sends the cookies and nothing else, so a
 * browser-side write has to add the header itself.
 *
 * The csrf cookie is deliberately not HttpOnly so that this can read it.
 * `__Host-csrf` is the secure-context name. `csrf` is used when SECURE_COOKIE is
 * off, which is how local development and browser test runs work.
 */
const NAMES = ['__Host-csrf', 'csrf'];

/** Reads the double-submit token, or an empty string outside the browser. */
export function csrfToken(): string {
	if (typeof document === 'undefined') return '';
	for (const name of NAMES) {
		const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
		if (match?.[1]) return decodeURIComponent(match[1]);
	}
	return '';
}

/** Merges the CSRF header into headers for a browser-side write. */
export function csrfHeaders(headers: Record<string, string> = {}): Record<string, string> {
	const token = csrfToken();
	return token ? { ...headers, 'X-CSRF-Token': token } : headers;
}
