/**
 * A redirect target that a form submitted, reduced to something safe to follow.
 *
 * An action that returns the operator to where they were has to be told where
 * that was, and the only place that can come from is the request. A path taken
 * from a form is attacker-controlled: `//evil.example` and `https://evil.example`
 * are both accepted by `redirect()` and both leave the instance, and a path
 * carrying a newline splits the Location header. So the value is not sanitized
 * into shape, it is checked and otherwise dropped for the caller's fallback.
 */

/** Control characters and the space, which have no place in a path we build a header from. */
const UNSAFE = /[\u0000-\u0020\u007f]/;

/** Whether a path stays on this origin. */
function isLocal(path: string): boolean {
	// A second leading slash, or a backslash after the first one, is a
	// protocol-relative URL that browsers follow off-origin.
	if (!path.startsWith('/') || path.startsWith('//') || path.startsWith('/\\')) return false;
	// A path that needs one of these spells it with a percent escape, so
	// refusing the literal costs nothing.
	return !UNSAFE.test(path);
}

/** The submitted path when it names a place on this instance, and the fallback otherwise. */
export function localPath(raw: FormDataEntryValue | null | undefined, fallback: string): string {
	if (typeof raw !== 'string') return fallback;
	const path = raw.trim();
	return path && isLocal(path) ? path : fallback;
}

/**
 * Where the sign-in page sends a person after they sign in: the path it was
 * asked to return to when that is a page of the admin, and the fallback
 * otherwise. A page that needs a signed-in visitor, such as the device
 * approval page, sends them to sign in with the path it wants back.
 */
export function adminReturnPath(raw: string | null | undefined, fallback: string): string {
	const path = localPath(raw, fallback);
	return path === '/admin' || path.startsWith('/admin/') || path.startsWith('/admin?') ? path : fallback;
}
