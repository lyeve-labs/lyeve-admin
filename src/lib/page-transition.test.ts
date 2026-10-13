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

	it('swaps without a fade under reduced motion', () => {
		const b = browser({ reducedMotion: true });
		expect(fadeRouteChange(navigation('/dashboard', '/billing'))).toBeUndefined();
		expect(b.startViewTransition).not.toHaveBeenCalled();
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
