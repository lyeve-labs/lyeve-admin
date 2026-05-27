/**
 * isExternalHref reports whether href leaves the admin console. The engine
 * sends an in-console path for a plugin's upgrade link by default, and an
 * operator may point it at an absolute URL instead. Only the second opens in
 * a new tab.
 */
export function isExternalHref(href: string): boolean {
	return /^[a-z][a-z0-9+.-]*:\/\//i.test(href) || href.startsWith('//');
}

/**
 * A link the engine or the license module sent, when it is safe to put in an
 * href: an https URL, or a path on this console. Anything else is dropped, and
 * the caller shows no link or falls back to one it trusts.
 */
export function linkHref(url: string | null | undefined): string | null {
	const href = (url ?? '').trim();
	if (href === '/admin' || href.startsWith('/admin/') || href.startsWith('/admin?')) return href;
	return /^https:\/\/[^/\s]/i.test(href) ? href : null;
}
