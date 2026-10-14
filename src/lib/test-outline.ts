/**
 * The heading skips a page's outline holds, for page tests.
 *
 * A screen reader lists a page by its headings, and a jump down by more than
 * one level, such as h1 to h3, reads as a missing section. Going back up any
 * number of levels is fine. Headings inside a closed overlay, an inert subtree
 * or a hidden one are not read, so they are left out.
 */
export function outlineSkips(root: ParentNode = document.body): string[] {
	const skips: string[] = [];
	let previous = 0;
	for (const heading of root.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')) {
		if (heading.closest('[inert], [hidden], [aria-hidden="true"]')) continue;
		const level = Number(heading.tagName.slice(1));
		if (level > previous + 1) {
			const name = heading.textContent?.trim().replace(/\s+/g, ' ') ?? '';
			skips.push(`h${previous || 0} to h${level}: ${name}`);
		}
		previous = level;
	}
	return skips;
}
