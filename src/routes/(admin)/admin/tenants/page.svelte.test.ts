// @vitest-environment jsdom
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

const nav = vi.hoisted(() => ({
	goto: vi.fn(async (_url: string, _opts?: Record<string, unknown>) => {}),
}));
vi.mock('$app/navigation', () => nav);
vi.mock('$app/forms', () => ({ enhance: () => ({ destroy: () => {} }) }));

import TenantsPage from './+page.svelte';

afterEach(() => {
	cleanup();
	nav.goto.mockClear();
});

function tenants(count: number, from = 0) {
	return Array.from({ length: count }, (_, i) => ({
		id: `t${from + i}`,
		slug: `tenant-${from + i}`,
		name: `Tenant ${from + i}`,
		plan: 'example',
		enabled: true,
		archived: false,
		created_at: '2026-01-01T00:00:00Z',
		updated_at: '2026-01-01T00:00:00Z',
	}));
}

function data(overrides: Record<string, unknown> = {}) {
	return {
		tenants: tenants(50),
		limit: 50,
		offset: 0,
		total: 731,
		// Creating is enabled, so a pagination test is not also a gate test.
		canProvision: true,
		...overrides,
	};
}

const props = (over: Record<string, unknown> = {}) =>
	({ data: data(over) as never, form: null as never });

describe('Tenants provisioning gate', () => {
	// The list is always drawn. Only a create is refused where the plugin does
	// not enable it, so the create control is drawn only where creating is
	// enabled.
	it('draws the list where creating is not enabled', () => {
		const { container } = render(TenantsPage, { props: props({ canProvision: false }) });

		expect(container.textContent).toContain('731 tenants on this instance');
		expect(container.textContent).toContain('tenant-0');
	});

	it('draws no create control where creating is not enabled, and keeps the row actions', () => {
		const { container } = render(TenantsPage, { props: props({ canProvision: false }) });

		expect(container.textContent).not.toContain('New tenant');
		expect(container.querySelector('[aria-label^="Edit "]')).not.toBeNull();
		expect(container.querySelector('[aria-label^="Disable "]')).not.toBeNull();
		expect(container.querySelector('[aria-label^="Delete "]')).not.toBeNull();
	});

	it('says creating is not enabled rather than leaving the refusal to the form', () => {
		const { container, getByTestId } = render(TenantsPage, { props: props({ canProvision: false }) });

		expect(container.textContent).toContain('Tenant provisioning');
		expect(getByTestId('not-enabled').textContent).toContain('Not enabled on this instance.');
	});

	it('draws the create control where creating is enabled', () => {
		const { container } = render(TenantsPage, { props: props() });

		expect(container.textContent).toContain('New tenant');
		expect(container.querySelector('[aria-label^="Edit "]')).not.toBeNull();
	});

	it('offers no create action from the empty state where creating is not enabled', () => {
		const { container } = render(
			TenantsPage,
			{ props: props({ tenants: [], total: 0, canProvision: false }) },
		);

		expect(container.textContent).toContain('No tenants yet');
		expect(container.textContent).not.toContain('New tenant');
	});
});

describe('Tenants plan', () => {
	it('shows the plan as stored, and a dash for a tenant with none', () => {
		const rows = [{ ...tenants(1)[0], plan: '' }, ...tenants(1, 1)];
		const { container } = render(TenantsPage, { props: props({ tenants: rows, total: 2 }) });
		const cells = [...container.querySelectorAll('tbody tr')].map((tr) => tr.querySelectorAll('td')[2]?.textContent?.trim());

		expect(cells).toEqual(['-', 'example']);
	});
});

describe('Tenants pagination', () => {
	// One server page is not the instance, so the heading states the
	// collection's count.
	it('heads the page with the count of the collection, not of the page', () => {
		const { container } = render(TenantsPage, { props: props() });

		expect(container.textContent).toContain('731 tenants on this instance');
	});

	it('states the slice on screen and the real total', () => {
		const { container } = render(TenantsPage, { props: props() });

		expect(container.textContent).toContain('1 to 50 of 731');
	});

	it('moves the offset by one page when a page number is pressed', async () => {
		const { getByRole } = render(TenantsPage, { props: props() });

		await fireEvent.click(getByRole('button', { name: 'Next page' }));

		expect(nav.goto).toHaveBeenCalledWith(
			'/admin/tenants?limit=50&offset=50',
			expect.objectContaining({ noScroll: true })
		);
	});

	it('marks the page an offset lands inside', () => {
		const { getByRole } = render(TenantsPage, {
			props: props({ offset: 100, tenants: tenants(50, 100) }),
		});

		expect(getByRole('button', { name: '3' }).getAttribute('aria-current')).toBe('page');
	});

	// A pager that offers a fifteenth page of a fifteen-page collection sends a
	// reader to an empty table.
	it('offers no next page on the last one', () => {
		const { getByRole } = render(TenantsPage, {
			props: props({ offset: 700, tenants: tenants(31, 700) }),
		});

		expect(getByRole('button', { name: 'Next page' })).toHaveProperty('disabled', true);
	});

	it('says so when the instance has no tenants at all', () => {
		const { container } = render(TenantsPage, {
			props: props({ tenants: [], total: 0 }),
		});

		expect(container.textContent).toContain('No tenants yet');
	});
});
