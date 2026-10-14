import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SubmitFunction } from '@sveltejs/kit';
import { confirmed, submitter, tracked } from './forms.svelte';

const kit = vi.hoisted(() => ({
	confirm: vi.fn(async () => true),
	success: vi.fn(),
}));
vi.mock('@lyeve-labs/ui-kit', () => ({
	confirm: kit.confirm,
	toast: { success: kit.success },
}));

/** The half of the enhance contract a test has to supply. */
const opts = (type: 'success' | 'failure' | 'error' = 'success', data: Record<string, unknown> = {}) => ({
	formData: new FormData(),
	formElement: {} as HTMLFormElement,
	action: new URL('http://x/?/create'),
	result: { type, status: 200, data } as never,
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
		expect(o.update).toHaveBeenCalledWith({ reset: true });
	});

	it('keeps the fields of a form whose answer is built from them', async () => {
		const s = submitter(undefined, { reset: false });
		const o = await run(s.enhance);
		expect(o.update).toHaveBeenCalledWith({ reset: false });
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

describe('confirmed', () => {
	function start(type: 'success' | 'failure' | 'error' = 'success', data: Record<string, unknown> = {}) {
		const o = opts(type, data);
		const cancel = vi.fn();
		return { o, cancel, input: { ...o, cancel, submitter: null, controller: new AbortController() } as never };
	}

	beforeEach(() => {
		kit.confirm.mockReset();
		kit.confirm.mockResolvedValue(true);
		kit.success.mockReset();
	});

	it('asks the question with its detail and only the kit options', async () => {
		const { input } = start();
		await confirmed('Delete job nightly?', 'Its history goes with it.', {
			confirmLabel: 'Delete',
			detail: 'job-1',
			success: 'Deleted nightly',
		})(input);
		expect(kit.confirm).toHaveBeenCalledWith('Delete job nightly?', 'Its history goes with it.', {
			confirmLabel: 'Delete',
			detail: 'job-1',
		});
	});

	it('cancels the request and applies nothing when the question is declined', async () => {
		kit.confirm.mockResolvedValue(false);
		const { o, cancel, input } = start();
		const after = await confirmed('Delete it?', 'Gone.', { confirmLabel: 'Delete', success: 'Deleted' })(input);
		expect(cancel).toHaveBeenCalledOnce();
		expect(after).toBeUndefined();
		expect(o.update).not.toHaveBeenCalled();
		expect(kit.success).not.toHaveBeenCalled();
	});

	it('applies the result and says what happened once the write goes through', async () => {
		const { o, cancel, input } = start();
		const after = await confirmed('Delete it?', 'Gone.', { confirmLabel: 'Delete', success: 'Deleted it' })(input);
		await after!(o as never);
		expect(cancel).not.toHaveBeenCalled();
		expect(o.update).toHaveBeenCalledWith();
		expect(kit.success).toHaveBeenCalledWith('Deleted it');
	});

	it('raises no toast over a refused write, which the page shows itself', async () => {
		for (const type of ['failure', 'error'] as const) {
			const { o, input } = start(type);
			const after = await confirmed('Delete it?', 'Gone.', { confirmLabel: 'Delete', success: 'Deleted it' })(input);
			await after!(o as never);
			expect(o.update).toHaveBeenCalledOnce();
		}
		expect(kit.success).not.toHaveBeenCalled();
	});

	it('raises no toast when the caller names none', async () => {
		const { o, input } = start();
		const after = await confirmed('Archive it?', 'Writes stop.', { confirmLabel: 'Archive' })(input);
		await after!(o as never);
		expect(o.update).toHaveBeenCalledOnce();
		expect(kit.success).not.toHaveBeenCalled();
	});

	it("builds the toast from the action's answer when it is a function", async () => {
		const { o, input } = start('success', { purged: 3 });
		const after = await confirmed('Purge it?', 'Recomputed.', {
			confirmLabel: 'Purge',
			success: (data) => `Purged ${String(data?.purged)}`,
		})(input);
		await after!(o as never);
		expect(kit.success).toHaveBeenCalledWith('Purged 3');
	});
});
