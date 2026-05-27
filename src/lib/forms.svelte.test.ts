import { describe, expect, it, vi } from 'vitest';
import type { SubmitFunction } from '@sveltejs/kit';
import { submitter, tracked } from './forms.svelte';

/** The half of the enhance contract a test has to supply. */
const opts = (type: 'success' | 'failure' | 'error' = 'success') => ({
	formData: new FormData(),
	formElement: {} as HTMLFormElement,
	action: new URL('http://x/?/create'),
	result: { type, status: 200, data: {} } as never,
	update: vi.fn(async () => {}),
});

/** Run one submit through a handler and hand back the update spy. */
async function run(enhance: SubmitFunction, type: 'success' | 'failure' | 'error' = 'success') {
	const o = opts(type);
	const after = await enhance({
		...o,
		cancel: vi.fn(),
		submitter: null,
		controller: new AbortController(),
	} as never);
	if (after) await after(o as never);
	return o;
}

describe('submitter', () => {
	it('is not pending before anything is submitted', () => {
		expect(submitter().pending).toBe(false);
	});

	it('closes the panel once the write goes through', async () => {
		const close = vi.fn();
		const s = submitter(close);
		await run(s.enhance);
		expect(close).toHaveBeenCalledOnce();
	});

	it('leaves the panel open on a rejected write', async () => {
		// The error has to be visible against the values that caused it.
		const close = vi.fn();
		const s = submitter(close);
		await run(s.enhance, 'failure');
		expect(close).not.toHaveBeenCalled();
	});

	it('is pending while the write is in flight and not after', async () => {
		// Without this the primary sits live and unchanged for the whole round
		// trip, which reads as "nothing happened", which is how a create panel
		// produces duplicate rows.
		const s = submitter();
		const o = opts();
		const after = await s.enhance({ ...o, cancel: vi.fn() } as never);
		expect(s.pending).toBe(true);
		await after!(o as never);
		expect(s.pending).toBe(false);
	});

	it('applies the result, so the page is not left showing what it submitted', async () => {
		const s = submitter();
		const o = await run(s.enhance);
		expect(o.update).toHaveBeenCalled();
	});
});

describe('tracked', () => {
	it('runs the handler the page wrote, unchanged', async () => {
		const inner = vi.fn();
		const t = tracked((() => inner) as unknown as SubmitFunction);
		await run(t.enhance);
		expect(inner).toHaveBeenCalledOnce();
	});

	it('clears pending even when the handler throws', async () => {
		const t = tracked((() => {
			throw new Error('nope');
		}) as unknown as SubmitFunction);
		await expect(run(t.enhance)).rejects.toThrow('nope');
		expect(t.pending).toBe(false);
	});

	it('falls back to applying the result when the handler returns nothing', async () => {
		// Returning a callback unconditionally would swallow SvelteKit's own
		// default and leave the page showing the values it submitted.
		const t = tracked((() => undefined) as unknown as SubmitFunction);
		const o = await run(t.enhance);
		expect(o.update).toHaveBeenCalled();
	});
});

describe('a handler that cancels', () => {
	/**
	 * A confirm-then-submit handler cancels when the question is declined, and
	 * enhance never calls the callback after that. Many handlers here have
	 * that shape, so a wrapper that only clears its flag in the callback leaves
	 * the primary spinning until the reader navigates away.
	 */
	it('clears pending when the wrapped handler declines', async () => {
		const t = tracked((({ cancel }: { cancel: () => void }) => {
			cancel();
		}) as unknown as SubmitFunction);
		const o = opts();
		const after = await t.enhance({ ...o, cancel: vi.fn() } as never);
		expect(t.pending).toBe(false);
		// The returned callback is inert, so nothing is applied over a submit
		// that never went.
		await after!(o as never);
		expect(o.update).not.toHaveBeenCalled();
	});

	it('still clears pending on a handler that goes through', async () => {
		const t = tracked((() => async () => {}) as unknown as SubmitFunction);
		const o = opts();
		const after = await t.enhance({ ...o, cancel: vi.fn() } as never);
		expect(t.pending).toBe(true);
		await after!(o as never);
		expect(t.pending).toBe(false);
	});
});
