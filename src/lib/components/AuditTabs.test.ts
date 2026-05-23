// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

const goto = vi.fn();
vi.mock('$app/navigation', () => ({ goto: (href: string) => goto(href) }));

import AuditTabs from './AuditTabs.svelte';

afterEach(() => {
	cleanup();
	goto.mockClear();
});

/*
 * Entries and retention are one plugin over one table, so they are two routes
 * behind one strip. Each half keeps its own load and its own form actions, and
 * a filtered view stays a link somebody can keep.
 */
describe('AuditTabs', () => {
	it('names both halves', () => {
		const { getByRole } = render(AuditTabs, { props: { active: 'entries' } as never });
		expect(getByRole('tab', { name: /Entries/ })).toBeTruthy();
		expect(getByRole('tab', { name: /Retention and holds/ })).toBeTruthy();
	});

	it('marks the half that is on screen', () => {
		const { getByRole } = render(AuditTabs, { props: { active: 'retention' } as never });
		expect(getByRole('tab', { name: /Retention and holds/ }).getAttribute('aria-selected')).toBe(
			'true'
		);
		expect(getByRole('tab', { name: /Entries/ }).getAttribute('aria-selected')).toBe('false');
	});

	it('navigates rather than swapping a panel', async () => {
		const { getByRole } = render(AuditTabs, { props: { active: 'entries' } as never });
		getByRole('tab', { name: /Retention and holds/ }).click();
		await Promise.resolve();
		expect(goto).toHaveBeenCalledWith('/admin/audit-log/retention');
	});

	// A count the page has not read is left off rather than drawn as zero. An
	// unread hold list rendered as "0" is the same mistake the retention page
	// already guards against on its own rows.
	it('draws no count when the page passed none', () => {
		const { getByRole } = render(AuditTabs, { props: { active: 'entries' } as never });
		expect(getByRole('tab', { name: /Entries/ }).textContent).not.toMatch(/\d/);
	});

	it('draws the counts the page did pass', () => {
		const { getByRole } = render(AuditTabs, {
			props: { active: 'entries', entries: 412, rules: 3 } as never
		});
		expect(getByRole('tab', { name: /Entries/ }).textContent).toContain('412');
		expect(getByRole('tab', { name: /Retention and holds/ }).textContent).toContain('3');
	});

	it('links the streaming half', async () => {
		const { getByRole } = render(AuditTabs, { props: { active: 'entries' } as never });
		getByRole('tab', { name: /Streaming/ }).click();
		await Promise.resolve();
		expect(goto).toHaveBeenCalledWith('/admin/audit-log/sinks');
	});
});
