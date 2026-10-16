import { globSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OnNavigate } from '@sveltejs/kit';
import { FADING, fadeRouteChange } from './page-transition';

function navigation(from: string, to: string, complete: Promise<void> = Promise.resolve()) {
	return {
		from: { url: new URL(from, 'https://app.test') },
		to: { url: new URL(to, 'https://app.test') },
		complete,
	} as unknown as OnNavigate;
}

/** A browser with view transitions. The test ends each transition by hand. */
function browser({ reducedMotion = false } = {}) {
	const attrs = new Set<string>();
	const finishers: Array<() => void> = [];
	const startViewTransition = vi.fn((update: () => Promise<void>) => {
		const finished = new Promise<void>((r) => finishers.push(r));
		return { ready: Promise.resolve(), updateCallbackDone: update(), finished };
	});
	vi.stubGlobal('document', {
		startViewTransition,
		documentElement: {
			setAttribute: (name: string) => attrs.add(name),
			removeAttribute: (name: string) => attrs.delete(name),
		},
	});
	vi.stubGlobal('window', { matchMedia: () => ({ matches: reducedMotion }) });
	return { startViewTransition, attrs, finish: (i: number) => finishers[i]() };
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('fadeRouteChange', () => {
	it('fades a change of page and lets the navigation go on once the snapshot is taken', async () => {
		const b = browser();
		const pending = fadeRouteChange(navigation('/dashboard', '/billing'));
		expect(b.startViewTransition).toHaveBeenCalledOnce();
		await expect(pending).resolves.toBeUndefined();
		b.finish(0);
		await vi.waitFor(() => expect(b.attrs.has(FADING)).toBe(false));
	});

	it('marks the document while the fade runs and clears it after', async () => {
		const b = browser();
		await fadeRouteChange(navigation('/dashboard', '/billing'));
		expect(b.attrs.has(FADING)).toBe(true);
		b.finish(0);
		await vi.waitFor(() => expect(b.attrs.has(FADING)).toBe(false));
	});

	it('keeps the mark until the last of two overlapping fades ends', async () => {
		const b = browser();
		await fadeRouteChange(navigation('/a', '/b'));
		await fadeRouteChange(navigation('/b', '/c'));
		b.finish(0);
		await new Promise((r) => setTimeout(r, 0));
		expect(b.attrs.has(FADING)).toBe(true);
		b.finish(1);
		await vi.waitFor(() => expect(b.attrs.has(FADING)).toBe(false));
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
		const b = browser({ reducedMotion: true });
		const matchMedia = vi.fn(() => ({ matches: true }));
		vi.stubGlobal('window', { matchMedia });
		await fadeRouteChange(navigation('/dashboard', '/billing'));
		expect(b.startViewTransition).toHaveBeenCalledOnce();
		expect(matchMedia).not.toHaveBeenCalled();
		b.finish(0);
		await vi.waitFor(() => expect(b.attrs.has(FADING)).toBe(false));
	});

	it('swaps without a fade in a browser that has no view transitions', () => {
		vi.stubGlobal('document', { documentElement: {} });
		expect(fadeRouteChange(navigation('/dashboard', '/billing'))).toBeUndefined();
	});

	it('reports nothing when the navigation fails mid-fade', async () => {
		const b = browser();
		const failed = Promise.reject(new Error('navigation aborted'));
		failed.catch(() => {});
		await fadeRouteChange(navigation('/dashboard', '/billing', failed));
		b.finish(0);
		// An unhandled rejection from the transition fails the run on this tick.
		await new Promise((r) => setTimeout(r, 0));
		await vi.waitFor(() => expect(b.attrs.has(FADING)).toBe(false));
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
