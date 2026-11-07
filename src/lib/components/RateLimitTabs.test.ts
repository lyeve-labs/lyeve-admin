// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

const goto = vi.fn();
vi.mock('$app/navigation', () => ({ goto: (href: string) => goto(href) }));

import RateLimitTabs from './RateLimitTabs.svelte';

afterEach(() => {
	cleanup();
	goto.mockClear();
});

const labels = (container: HTMLElement) => [...container.querySelectorAll('[role="tab"]')].map((t) => t.textContent?.trim());

/*
 * The only strip whose tabs depend on the role. An admin reaches this tenant's
 * controls from the sidebar and never the instance pages, so the instance tabs
 * are a super admin's alone.
 */
describe('RateLimitTabs', () => {
	it('names all four pages for a super admin', () => {
		const { container } = render(RateLimitTabs, { props: { active: 'limits', superAdmin: true } });
		expect(labels(container)).toEqual(['Limits', 'Right now', 'Tenant controls', 'Refusal history']);
	});

	it('names only the tenant pages for an admin', () => {
		const { container } = render(RateLimitTabs, { props: { active: 'tenant', superAdmin: false } });
		expect(labels(container)).toEqual(['Tenant controls', 'Refusal history']);
	});

	it('marks the page that is on screen', () => {
		const { getByRole } = render(RateLimitTabs, { props: { active: 'refusals', superAdmin: true } });
		expect(getByRole('tab', { name: 'Refusal history' }).getAttribute('aria-selected')).toBe('true');
		expect(getByRole('tab', { name: 'Limits' }).getAttribute('aria-selected')).toBe('false');
	});

	it.each([
		['Limits', '/admin/settings/rate-limits'],
		['Right now', '/admin/settings/rate-limits/live'],
		['Tenant controls', '/admin/settings/rate-limits/tenant'],
		['Refusal history', '/admin/settings/rate-limits/tenant/refusals'],
	])('navigates to %s rather than swapping a panel', async (name, href) => {
		const active = name === 'Limits' ? 'live' : 'limits';
		const { getByRole } = render(RateLimitTabs, { props: { active, superAdmin: true } });
		getByRole('tab', { name }).click();
		await Promise.resolve();
		expect(goto).toHaveBeenCalledWith(href);
	});
});
