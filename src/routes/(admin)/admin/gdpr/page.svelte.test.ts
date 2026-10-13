// @vitest-environment jsdom
import { render, cleanup } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy: () => {} }) }));

import GdprPage from './+page.svelte';

afterEach(cleanup);

const said = (c: HTMLElement) => (c.textContent ?? '').replace(/\s+/g, ' ');

function erased(errors: string[] | undefined, extra: Record<string, unknown> = {}) {
	return {
		form: {
			action: 'erase',
			ok: true,
			subject: 'jane@example.com',
			result: { identifier: 'jane@example.com', total_rows: 12, errors, ...extra },
		} as never,
	};
}

// The only sentence the engine sends when an eraser fails.
const ERASERS_FAILED = 'one or more erasers failed';

// An erasure that failed in one plugin leaves the subject's data there. A
// green "complete" that clears itself would close the request on data that
// is still held.
describe('Privacy request erasure outcome', () => {
	it('calls an erasure with failures incomplete and says where to look', () => {
		const { container } = render(GdprPage, { props: erased([ERASERS_FAILED]) });
		const text = said(container);
		expect(text).toContain('Erasure incomplete');
		expect(text).not.toContain('Erasure complete');
		expect(text).toContain('data for this subject is still held there');
		expect(text).toContain("The engine's log names the part that failed.");
		const items = [...container.querySelectorAll('li')].map((li) => li.textContent?.trim());
		expect(items).toEqual([ERASERS_FAILED]);
	});

	it('keeps the incomplete erasure on screen until it is dismissed', async () => {
		vi.useFakeTimers();
		try {
			const { container } = render(GdprPage, { props: erased([ERASERS_FAILED]) });
			await vi.advanceTimersByTimeAsync(60_000);
			await tick();
			expect(said(container)).toContain('Erasure incomplete');
		} finally {
			vi.useRealTimers();
		}
	});

	// A legal hold stops the erasure before anything is erased. The engine
	// answers with no rows and no errors and names the holds.
	it('says a held erasure erased nothing and names the holds', () => {
		const { container } = render(GdprPage, {
			props: erased([], { total_rows: 0, holds: [{ id: 'h1', reason: 'Litigation 42' }, { id: 'h2' }] }),
		});
		const text = said(container);
		expect(text).toContain('Erasure held');
		expect(text).not.toContain('Erasure complete');
		expect(text).toContain('Nothing was erased');
		expect(text).toContain('under audit retention, then run the erasure again');
		const items = [...container.querySelectorAll('li')].map((li) => li.textContent?.trim());
		expect(items).toEqual(['Litigation 42', 'h2']);
	});

	it('calls an erasure with no failures complete', () => {
		const { container } = render(GdprPage, { props: erased([]) });
		expect(said(container)).toContain('Erasure complete');
		expect(said(container)).toContain('Erased 12 rows');
	});
});
