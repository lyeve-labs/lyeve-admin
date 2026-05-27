/**
 * Narrows the rows already on screen by a typed fragment.
 *
 * Most admin endpoints page a list and take no search, so the page cannot ask
 * the engine for "everything called acme". What it can do is read the page it
 * has: a case-insensitive substring over the columns a person recognizes a
 * row by. That is a narrowing of one page, never a search of the collection,
 * and every list that uses it says so beside the pager.
 */
export function narrows(needle: string, ...fields: (string | null | undefined)[]): boolean {
	const q = needle.trim().toLowerCase();
	if (!q) return true;
	return fields.some((f) => typeof f === 'string' && f.toLowerCase().includes(q));
}
