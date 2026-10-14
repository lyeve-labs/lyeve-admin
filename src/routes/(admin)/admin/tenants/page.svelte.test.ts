// @vitest-environment jsdom
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy: () => {} }) }));

import TenantsPage from './+page.svelte';

afterEach(cleanup);

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
	// A bare array of rows is a read that answered. Anything else is passed
	// through, so a case can hand the page a failed read.
	const { tenants: rows = tenants(50), ...rest } = overrides;
	return {
		tenants: Array.isArray(rows) ? { ok: true, value: rows } : rows,
		limit: 50,
		offset: 0,
		total: 731,
		// Creating is enabled, so a pagination test is not also a gate test.
		canProvision: true,
		...rest,
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

	// A link turns the page before the page hydrates, which a callback cannot.
	it('links the next page by its offset', () => {
		const { getByRole } = render(TenantsPage, { props: props() });

		expect(getByRole('link', { name: 'Next page' }).getAttribute('href')).toBe('/admin/tenants?limit=50&offset=50');
	});

	it('marks the page an offset lands inside', () => {
		const { getByRole } = render(TenantsPage, {
			props: props({ offset: 100, tenants: tenants(50, 100) }),
		});

		expect(getByRole('link', { name: '3' }).getAttribute('aria-current')).toBe('page');
	});

	// A pager that offers a fifteenth page of a fifteen-page collection sends a
	// reader to an empty table.
	it('offers no next page on the last one', () => {
		const { container } = render(TenantsPage, {
			props: props({ offset: 700, tenants: tenants(31, 700) }),
		});

		const next = container.querySelector('a[aria-label="Next page"]') as HTMLAnchorElement;
		expect(next.getAttribute('aria-disabled')).toBe('true');
		expect(next.getAttribute('href')).toBeNull();
	});

	it('says so when the instance has no tenants at all', () => {
		const { container } = render(TenantsPage, {
			props: props({ tenants: [], total: 0 }),
		});

		expect(container.textContent).toContain('No tenants yet');
	});
});

/*
 * The first-run state invites the reader to create the first tenant. Drawn
 * over a read that failed, it tells somebody whose engine is down that the
 * instance has no tenants.
 */
describe('Tenants when the list could not be read', () => {
	it('says the engine did not answer and offers no create, no pager and no count', () => {
		const { container, queryByRole } = render(TenantsPage, {
			props: props({ tenants: { ok: false, gate: { state: 'unavailable' } }, canProvision: false, total: 0 }),
		});
		expect(container.textContent).toContain('so Tenants could not be read. Nothing was changed.');
		expect(container.textContent).not.toContain('No tenants yet');
		expect(container.textContent).not.toContain('0 tenants on this instance');
		expect(container.textContent).not.toContain('Tenant provisioning');
		expect(queryByRole('button', { name: /new tenant/i })).toBeNull();
		expect(container.querySelector('table')).toBeNull();
	});
});

/*
 * Every form on the page shares one action result. A drawer that read it
 * whole showed a failed delete in the next New tenant form as if that form
 * had failed.
 */
describe('the tenant drawer and the failures of other actions', () => {
	const drawerText = () => document.body.querySelector('form#tenant-form')?.textContent ?? '';

	it('leaves a newly opened create drawer clean after a failed delete', async () => {
		const { container, getAllByRole } = render(TenantsPage, {
			props: { data: data() as never, form: { action: 'delete', error: 'Failed to delete tenant' } as never },
		});
		expect(container.textContent).toContain('Failed to delete tenant');
		await fireEvent.click(getAllByRole('button', { name: /new tenant/i })[0]);
		expect(drawerText()).not.toContain('Failed to delete tenant');
	});

	it('shows a failed save inside the open drawer and not above the list', async () => {
		const { container, getAllByRole, rerender } = render(TenantsPage, { props: props() });
		await fireEvent.click(getAllByRole('button', { name: /new tenant/i })[0]);
		await rerender({ data: data() as never, form: { action: 'create', error: 'Failed to create tenant' } as never });
		expect(drawerText()).toContain('Failed to create tenant');
		const outside = container.textContent?.replace(drawerText(), '') ?? '';
		expect(outside).not.toContain('Failed to create tenant');
	});
});

/*
 * A provisioning read that did not answer says nothing about the license, so
 * the page never draws the not-enabled card for it.
 */
describe('Tenants when provisioning could not be read', () => {
	it('says it could not tell, offers no create and makes no licensing claim', () => {
		const { container, queryByTestId, queryByRole } = render(TenantsPage, {
			props: props({ canProvision: false, provisionGate: { state: 'unavailable' } }),
		});
		expect(container.textContent).toContain('so Tenant provisioning could not be read');
		expect(queryByTestId('not-enabled')).toBeNull();
		expect(queryByRole('button', { name: /new tenant/i })).toBeNull();
		expect(container.textContent).toContain('tenant-0');
	});
});
