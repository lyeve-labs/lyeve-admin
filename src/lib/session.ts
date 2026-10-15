/** Where the sign-in page says the session ended. */
export const SESSION_ENDED = '/login?ended=1';

/**
 * The sign-in page for a reader whose session the engine ended during a
 * request the browser made itself, with the way back to the page they were on.
 */
export function signInAgainHref(here: { pathname: string; search: string }): string {
	return `${SESSION_ENDED}&next=${encodeURIComponent(here.pathname + here.search)}`;
}
