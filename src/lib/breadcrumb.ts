import type { BackLink } from './back';

/** One crumb as the kit's Breadcrumb takes it. The last one carries no href. */
export type Crumb = { label: string; href?: string };

/**
 * The crumbs left once the back link has said where the page sits.
 *
 * PageShell renders the back link and the breadcrumb on one row, and a page
 * that hands it both would name its parent twice. The back link wins,
 * so the trail starts after the crumb that is the back target. Only the path
 * is compared: a back link keeps the list's live query, a crumb never does.
 */
export function crumbsAfter(back: BackLink | undefined, items: Crumb[]): Crumb[] {
	if (!back) return items;
	const target = path(back.href);
	let last = -1;
	items.forEach((item, i) => {
		if (item.href && path(item.href) === target) last = i;
	});
	return last < 0 ? items : items.slice(last + 1);
}

function path(href: string): string {
	return href.split(/[?#]/, 1)[0];
}
