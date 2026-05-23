import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Every page has to fit a 400px screen, and the one thing that makes that
 * impossible from inside a page is a minimum width on it. The shell owns the
 * gutter and the cap. A page that demands more room than a phone has pushes
 * its own primary action off the edge.
 *
 * Read from source rather than rendered: a minimum width is a class on an
 * element, and the class is there whether or not the page's data is.
 */
const PAGES = globSync('src/routes/**/+page.svelte');

/** The width a Tailwind min-width utility resolves to, in px, or null when it is not a width. */
function minWidthPx(utility: string): number | null {
	const arbitrary = /^min-w-\[(\d+(?:\.\d+)?)(px|rem)\]$/.exec(utility);
	if (arbitrary) return Number(arbitrary[1]) * (arbitrary[2] === 'rem' ? 16 : 1);
	const step = /^min-w-(\d+(?:\.\d+)?)$/.exec(utility);
	if (step) return Number(step[1]) * 4;
	const fraction = /^min-w-(\d+)\/(\d+)$/.exec(utility);
	if (fraction) return null;
	const named: Record<string, number> = {
		'min-w-xs': 320,
		'min-w-sm': 384,
		'min-w-md': 448,
		'min-w-lg': 512,
		'min-w-xl': 576,
		'min-w-2xl': 672,
		'min-w-3xl': 768,
		'min-w-4xl': 896,
		'min-w-5xl': 1024,
		'min-w-6xl': 1152,
		'min-w-7xl': 1280,
	};
	return named[utility] ?? null;
}

/** The opening tag of an element, with its class attribute flattened. */
function classesOf(tag: string): string[] {
	const m = /class="([^"]*)"/.exec(tag);
	return m ? m[1].split(/\s+/).filter(Boolean) : [];
}

describe('every page fits a 400px screen', () => {
	it('sets no minimum width wider than 400px on its root', () => {
		const offenders: string[] = [];
		for (const file of PAGES) {
			const src = readFileSync(file, 'utf8');
			const root = /<PageShell\b[^>]*>/.exec(src);
			if (!root) continue;
			for (const cls of classesOf(root[0])) {
				const px = minWidthPx(cls);
				if (px !== null && px > 400) offenders.push(`${file}: ${cls}`);
			}
		}
		expect(offenders).toEqual([]);
	});

	it('demands more than 400px only on a table, which has its own scroll box', () => {
		const offenders: string[] = [];
		for (const file of PAGES) {
			const src = readFileSync(file, 'utf8');
			for (const tag of src.match(/<[a-zA-Z][^>]*class="[^"]*"[^>]*>/g) ?? []) {
				const name = /^<([a-zA-Z][\w-]*)/.exec(tag)?.[1] ?? '';
				for (const cls of classesOf(tag)) {
					const px = minWidthPx(cls);
					if (px !== null && px > 400 && name !== 'table') {
						offenders.push(`${file}: <${name} ${cls}>`);
					}
				}
			}
		}
		expect(offenders).toEqual([]);
	});
});

/*
 * A choice among a few values is a SegmentedControl, in value mode or, when
 * the choice lives in the URL, in href mode, so the same job always wears one
 * look. A ButtonGroup is for actions that belong together, such as undo and
 * redo, or for toggles that can all be off. A link that is current is a
 * choice.
 */
describe('every choice among a few values is a SegmentedControl', () => {
	it('marks no link inside a ButtonGroup as current', () => {
		const offenders: string[] = [];
		for (const file of PAGES) {
			const src = readFileSync(file, 'utf8');
			for (const group of src.match(/<ButtonGroup\b[\s\S]*?<\/ButtonGroup>/g) ?? []) {
				if (/aria-current=/.test(group)) offenders.push(file);
			}
		}
		expect(offenders).toEqual([]);
	});
});
