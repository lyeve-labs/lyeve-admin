// @vitest-environment jsdom
import { render, cleanup } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy: () => {} }) }));

import GdprPage from './+page.svelte';

afterEach(cleanup);

const said = (c: HTMLElement) => (c.textContent ?? '').replace(/\s+/g, ' ');

function erased(errors: string[] | undefined) {
	return {
		form: { action: 'erase', ok: true, subject: 'jane@example.com', result: { identifier: 'jane@example.com', total_rows: 12, errors } } as never,
	};
}

// An erasure that failed in one plugin leaves the subject's data there. A
// green "complete" that clears itself would close the request on data that
// is still held.
describe('Privacy request erasure outcome', () => {
	it('calls an erasure with failures incomplete and lists each failure', () => {
		const { container } = render(GdprPage, { props: erased(['comments: timeout', 'media: storage refused']) });
		const text = said(container);
		expect(text).toContain('Erasure incomplete');
		expect(text).not.toContain('Erasure complete');
		expect(text).toContain('Data for this subject is still held there');
		const items = [...container.querySelectorAll('li')].map((li) => li.textContent?.trim());
		expect(items).toEqual(['comments: timeout', 'media: storage refused']);
	});

	it('calls an erasure with no failures complete', () => {
		const { container } = render(GdprPage, { props: erased([]) });
		expect(said(container)).toContain('Erasure complete');
		expect(said(container)).toContain('Erased 12 rows');
	});
});
