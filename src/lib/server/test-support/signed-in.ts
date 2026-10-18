// Test support only. Nothing the console serves imports this file.
/**
 * A fetch for a test's server event that answers the session check with the
 * given account and hands every other call to `fetch`. A page load reads the
 * account itself, so this is how a test holds a session, and the calls `fetch`
 * records stay the page's own.
 */
export function signedIn(fetch: typeof globalThis.fetch, user: unknown): typeof globalThis.fetch {
	return (async (input: RequestInfo | URL, init?: RequestInit) => {
		if (String(input instanceof Request ? input.url : input).includes('/api/admin/auth/me')) {
			return new Response(JSON.stringify(user), { status: 200, headers: { 'content-type': 'application/json' } });
		}
		return fetch(input, init);
	}) as typeof globalThis.fetch;
}
