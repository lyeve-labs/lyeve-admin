import { readFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { adminNav } from './nav';
import type { NavNode, NavTree } from '@lyeve-labs/ui-kit';

/**
 * The sidebar is the index of the product, and an index that calls a thing
 * something else is the defect: a reader who picks one name and lands on a
 * page titled with another cannot tell whether they are in the right place.
 */
const PAGE = 'src/routes/(admin)/admin';

function leaves(nodes: NavTree, parent?: string): { label: string; href: string; parent?: string }[] {
	const out: { label: string; href: string; parent?: string }[] = [];
	for (const node of nodes as NavNode[]) {
		if (node.href) out.push({ label: node.label, href: node.href, parent });
		if (node.children) out.push(...leaves(node.children, node.label));
	}
	return out;
}

/** The heading a page draws, as its PageShell states it. */
function heading(href: string): string | null {
	const file = `${PAGE}${href.replace(/^\/admin/, '')}/+page.svelte`;
	if (!existsSync(file)) return null;
	const shell = /<PageShell\b([\s\S]*?)>/.exec(readFileSync(file, 'utf8'));
	const title = shell && /\btitle="([^"]*)"/.exec(shell[1]);
	return title ? title[1] : null;
}

const named = leaves(adminNav(['super_admin']))
	.map((l) => ({ ...l, heading: heading(l.href) }))
	.filter((l): l is typeof l & { heading: string } => l.heading !== null);

describe('the sidebar and the page it opens', () => {
	it('finds the pages to check', () => {
		// A filter that matches nothing passes every assertion under it.
		expect(named.length).toBeGreaterThan(30);
	});

	it.each(named.map((l) => [l.href, l.label, l.heading, l.parent] as const))(
		'%s is called %s and opens %s',
		(_href, label, head, parent) => {
			// A child under a named section may drop the section's word, because
			// the section is on screen directly above it: AI > Providers opens
			// "AI providers" and reads correctly in both places.
			const short = parent !== undefined && head.toLowerCase().endsWith(label.toLowerCase());
			expect(short || label === head).toBe(true);
		},
	);
});

describe('one voice', () => {
	/** A product name is capitalized. A description of a screen is not. */
	const PRODUCT_NAMES = ['Schema Builder'];

	it.each(leaves(adminNav(['super_admin'])).map((l) => l.label))('%s reads as a sentence', (label) => {
		if (PRODUCT_NAMES.includes(label)) return;
		const rest = label.split(' ').slice(1);
		const titleCased = rest.filter((w) => /^[A-Z]/.test(w) && w !== w.toUpperCase());
		expect(titleCased).toEqual([]);
	});
});
