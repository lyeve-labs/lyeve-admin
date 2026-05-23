// @vitest-environment jsdom
import { render, cleanup } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ navigating: { to: null as unknown } }));
vi.mock('$app/state', () => state);

import RouteProgress from './RouteProgress.svelte';

const bar = (c: HTMLElement) => c.querySelector('[data-print="hide"]');

beforeEach(() => {
	vi.useFakeTimers();
});
afterEach(() => {
	vi.useRealTimers();
	cleanup();
	state.navigating.to = null;
});

describe('RouteProgress', () => {
	it('shows nothing while the reader is standing still', async () => {
		const { container } = render(RouteProgress);
		await vi.advanceTimersByTimeAsync(2_000);
		expect(bar(container)).toBeNull();
	});

	it('stays away for a navigation that resolves in a frame', async () => {
		// A bar that flashes on every click is worse than no bar.
		state.navigating.to = { url: new URL('http://localhost/admin/users') };
		const { container } = render(RouteProgress);
		await vi.advanceTimersByTimeAsync(100);
		expect(bar(container)).toBeNull();
	});

	it('appears once a navigation is taking long enough to notice', async () => {
		state.navigating.to = { url: new URL('http://localhost/admin/users') };
		const { container } = render(RouteProgress);
		await vi.advanceTimersByTimeAsync(300);
		expect(bar(container)).toBeTruthy();
	});

	it('carries a track of its own, so reduced motion still shows something', async () => {
		// Reduced motion stops every loop after one pass, which parks the moving
		// highlight off screen. The track is what carries the signal.
		state.navigating.to = { url: new URL('http://localhost/admin/users') };
		const { container } = render(RouteProgress);
		await vi.advanceTimersByTimeAsync(300);
		// A faint track such as brand/20 sits near 1.5:1 against the page, which
		// a reduced-motion reader cannot see.
		expect(bar(container)?.className).toContain('bg-brand/50');
	});

	it('says nothing to a screen reader, which hears the new page arrive', async () => {
		state.navigating.to = { url: new URL('http://localhost/admin/users') };
		const { container } = render(RouteProgress);
		await vi.advanceTimersByTimeAsync(300);
		expect(bar(container)?.getAttribute('aria-hidden')).toBe('true');
	});
});
