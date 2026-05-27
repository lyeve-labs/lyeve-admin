/** What a nested page hands PageShell's `back` prop. */
export type BackLink = { href: string; label: string };

/**
 * The list a detail page returns to, keeping the view the reader left.
 *
 * A list that can be filtered or paged forwards its live query on each row
 * link, so the detail page's own URL carries it. Only the named keys come
 * back, in the order given, so a stray parameter on the detail URL cannot
 * reach the list, and an empty value is dropped rather than sent as `?q=`.
 */
export function listBack(href: string, label: string, url: URL, keys: readonly string[]): BackLink {
	const params = new URLSearchParams();
	for (const key of keys) {
		const value = url.searchParams.get(key);
		if (value) params.set(key, value);
	}
	const query = params.toString();
	return { href: query ? `${href}?${query}` : href, label };
}

/**
 * The query a list row link carries so the detail page can hand it back.
 * Empty when nothing is set, so the common case stays a clean path.
 */
export function listQuery(filters: Record<string, string | number | null | undefined>): string {
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(filters)) {
		if (value !== null && value !== undefined && value !== '') params.set(key, String(value));
	}
	const query = params.toString();
	return query ? `?${query}` : '';
}
