import { globSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OnNavigate } from '@sveltejs/kit';
import { fadeRouteChange } from './page-transition';

function navigation(from: string, to: string, complete: Promise<void> = Promise.resolve()) {
	return {
		from: { url: new URL(from, 'https://app.test') },
		to: { url: new URL(to, 'https://app.test') },
		complete,
	} as unknown as OnNavigate;
}

/**
 * A browser with view transitions. Each of a transition's three promises
 * settles with its update, as in a real one, where all three reject when the
 * update fails. Each is a promise of its own, so each needs its own catch.
 */
function browser() {
	const startViewTransition = vi.fn((update: () => Promise<void>) => {
		const done = update();
		const settle = () => done.then(() => undefined);
		return { ready: settle(), updateCallbackDone: settle(), finished: settle() };
	});
	vi.stubGlobal('document', { startViewTransition, documentElement: {} });
	return { startViewTransition };
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('fadeRouteChange', () => {
	it('fades a change of page and lets the navigation go on once the snapshot is taken', async () => {
		const b = browser();
		await expect(fadeRouteChange(navigation('/dashboard', '/billing'))).resolves.toBeUndefined();
		expect(b.startViewTransition).toHaveBeenCalledOnce();
	});

	it('leaves a change of query alone', () => {
		const b = browser();
		expect(fadeRouteChange(navigation('/invoices?page=1', '/invoices?page=2'))).toBeUndefined();
		expect(b.startViewTransition).not.toHaveBeenCalled();
	});

	// The kit's stylesheet finishes the view-transition pseudo-elements in 1ms
	// under reduced motion, so the admin starts the transition either way and
	// never asks the media query itself.
	it('starts the transition under reduced motion too, without reading the preference', async () => {
		const b = browser();
		const matchMedia = vi.fn(() => ({ matches: true }));
		vi.stubGlobal('window', { matchMedia });
		await fadeRouteChange(navigation('/dashboard', '/billing'));
		expect(b.startViewTransition).toHaveBeenCalledOnce();
		expect(matchMedia).not.toHaveBeenCalled();
	});

	it('swaps without a fade in a browser that has no view transitions', () => {
		vi.stubGlobal('document', { documentElement: {} });
		expect(fadeRouteChange(navigation('/dashboard', '/billing'))).toBeUndefined();
	});

	it('reports nothing when the navigation fails mid-fade', async () => {
		browser();
		const failed = Promise.reject(new Error('navigation aborted'));
		failed.catch(() => {});
		await fadeRouteChange(navigation('/dashboard', '/billing', failed));
		// An unhandled rejection from the transition fails the run on this tick.
		await new Promise((r) => setTimeout(r, 0));
	});
});

describe('the route fade in app.css', () => {
	const css = readFileSync(fileURLToPath(new URL('../app.css', import.meta.url)), 'utf8');
	const rule = (selector: string) => {
		const at = css.indexOf(`${selector} {`);
		return at < 0 ? '' : css.slice(at, css.indexOf('}', at));
	};

	// A named region gets a snapshot of its own, and in Chrome the content
	// region's came out white, which flashed the dark theme white between pages.
	it('gives the content region no snapshot of its own', () => {
		expect(css).not.toMatch(/#content[^{}]*\{[^}]*view-transition-name/);
	});

	// The old page holds still under the new one, so what the two share, such
	// as the sidebar, would brighten under an additive blend.
	it('fades the new page in over the old one with normal blending', () => {
		expect(rule('::view-transition-old(root)')).toMatch(/animation:\s*none/);
		expect(rule('::view-transition-new(root)')).toMatch(/animation:\s*page-in/);
		expect(rule('::view-transition-new(root)')).toMatch(/mix-blend-mode:\s*normal/);
	});
});

// Reduced motion is honored once, in the kit's stylesheet. A second check in
// the admin is a second rule that can disagree with the first.
describe('reduced motion', () => {
	it('is decided nowhere in the admin', () => {
		const src = fileURLToPath(new URL('..', import.meta.url));
		const files = globSync('**/*.{ts,svelte,css}', { cwd: src }).filter((f) => !f.endsWith('.test.ts'));
		expect(files.length).toBeGreaterThan(0);
		expect(files.filter((f) => /prefers-reduced-motion/.test(readFileSync(join(src, f), 'utf8')))).toEqual([]);
	});
});
