// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Entitlements } from '$lib/entitlements';
import type { ValidationError } from '$lib/api/flows';
import { blockedFlow, fixtureFlow } from '$lib/flow/fixtures';
import { BLOCKED_TEXT } from '$lib/flow/blocked';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));

// Delete asks through the kit's confirm dialog, which renders through a
// container the layout mounts and this test does not. The call is captured.
const kit = vi.hoisted(() => ({ confirm: vi.fn(async () => false) }));
vi.mock('@lyeve-labs/ui-kit', async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	confirm: kit.confirm,
}));

import FlowsPage from './+page.svelte';

beforeEach(() => {
	kit.confirm.mockReset();
	kit.confirm.mockResolvedValue(false);
});

afterEach(cleanup);

const licensed: Entitlements = { plan: 'example', state: 'active', features: ['flow'], tenant_quota: 1 };

function setup(overrides: Record<string, unknown> = {}, entitlements = licensed) {
	return render(FlowsPage, {
		props: {
			data: {
				flows: [],
				limit: 50,
				offset: 0,
				total: null,
				hasMore: false,
				status: '',
				q: '',
				locked: false,
				loadError: null,
				entitlements,
				...overrides,
			},
			form: null,
		} as never,
	});
}

describe('flows list page', () => {
	it('lists each flow with its status, trigger, version and last run', () => {
		const active = {
			...fixtureFlow,
			id: 'f2',
			slug: 'active_one',
			name: 'Active one',
			status: 'active' as const,
			version: 3,
			last_run: { id: 'r1', status: 'succeeded' as const, started_at: new Date(Date.now() - 120_000).toISOString(), duration_ms: 40 },
		};
		const { container, getByText } = setup({ flows: [fixtureFlow, active] });
		expect(getByText('Beta')).toBeTruthy();
		const rows = container.querySelectorAll('tbody tr');
		expect(rows).toHaveLength(2);
		expect(rows[0].textContent).toContain('draft');
		expect(rows[0].textContent).toContain('API');
		expect(rows[0].textContent).toContain('unpublished');
		expect(rows[0].textContent).toContain('never');
		expect(rows[1].textContent).toContain('v3');
		expect(rows[1].textContent).toContain('succeeded');
		expect(rows[1].textContent).toContain('2 minutes ago');
		expect((getByText('Active one') as HTMLAnchorElement).getAttribute('href')).toBe('/admin/flows/f2');
	});

	it('offers no templates on an empty list: the editor asks that once there is a canvas', () => {
		const { getByText, container } = setup();
		expect(getByText('No flows yet')).toBeTruthy();
		expect(container.querySelector('[data-testid="flow-templates"]')).toBeNull();
		expect(container.textContent).not.toContain('Nightly sheet export');
	});

	it('asks for a name and a slug and nothing else', async () => {
		const { getAllByText, container } = setup();
		await fireEvent.click(getAllByText('New flow')[0]);
		const dialog = container.querySelector('[role="dialog"]') as HTMLElement;
		expect(dialog.textContent).toContain('New flow');
		expect(dialog.textContent).not.toContain('Start from');
		expect(dialog.querySelector('#create-from')).toBeNull();
		const form = dialog.querySelector('form[action="?/create"]') as HTMLFormElement;
		expect([...new FormData(form).keys()].sort()).toEqual(['name', 'slug']);
		expect(dialog.querySelectorAll('input:not([type="hidden"])')).toHaveLength(2);
	});

	it('derives the slug from the name until the slug is edited', async () => {
		const { getAllByText, container } = setup();
		await fireEvent.click(getAllByText('New flow')[0]);
		const name = container.querySelector('#create-name') as HTMLInputElement;
		await fireEvent.input(name, { target: { value: 'Orders With Shipments' } });
		const slug = container.querySelector('#create-slug') as HTMLInputElement;
		expect(slug.value).toBe('orders-with-shipments');
	});

	it('asks before deleting and names the flow', async () => {
		const { container, getByTitle } = setup({ flows: [fixtureFlow] });
		expect(container.querySelectorAll('tbody form[action="?/delete"]')).toHaveLength(0);
		const form = container.querySelector('form[action="?/delete"]') as HTMLFormElement;
		const submit = vi.spyOn(form, 'requestSubmit').mockImplementation(() => {});

		await fireEvent.click(getByTitle('Delete'));
		await tick();
		// The title asks the question and names the flow. The body says what the
		// delete takes with it.
		expect(kit.confirm).toHaveBeenCalledWith(
			expect.stringContaining(fixtureFlow.name),
			expect.stringContaining('run history'),
			{ confirmLabel: 'Delete' },
		);
		expect(submit).not.toHaveBeenCalled();

		kit.confirm.mockResolvedValue(true);
		await fireEvent.click(getByTitle('Delete'));
		await tick();
		await tick();
		expect(new FormData(form).get('id')).toBe('f1');
		expect(submit).toHaveBeenCalled();
	});

	it('renders the not-enabled state when the engine answered 402, and nothing to create', () => {
		const locked = setup({ locked: true });
		expect(locked.getByTestId('not-enabled')).toBeTruthy();
		expect(locked.queryByText('New flow')).toBeNull();
	});

	it('shows a failed load as an alert and not as an empty tenant', () => {
		const { container, queryByText } = setup({ loadError: 'Flows could not be read from the engine.' });
		expect(container.textContent).toContain('Flows could not be read from the engine.');
		expect(queryByText('No flows yet')).toBeNull();
		expect(container.querySelector('[data-testid="flow-templates"]')).toBeNull();
	});

	it('filters by status and search through query parameters', () => {
		const { getByTestId, getByRole } = setup({ status: 'active', q: 'orders', flows: [fixtureFlow] });
		const form = getByTestId('flow-filters') as HTMLFormElement;
		expect(form.getAttribute('method')).toBe('GET');
		expect((form.querySelector('input[name="status"]') as HTMLInputElement).value).toBe('active');
		expect((form.querySelector('input[name="q"]') as HTMLInputElement).value).toBe('orders');
		expect(getByRole('link', { name: 'Active' }).getAttribute('aria-current')).toBe('page');
		expect((getByRole('link', { name: 'Clear' }) as HTMLAnchorElement).getAttribute('href')).toBe('/admin/flows');
	});

	it('links each status with the search kept, so one click lands on it', () => {
		// A radio that submits from its change handler runs before the hidden
		// status field re-renders, so a click would post the status it is
		// leaving.
		const { getByRole } = setup({ status: 'draft', q: 'sync', flows: [fixtureFlow] });
		const href = (name: string) => getByRole('link', { name }).getAttribute('href');
		expect(href('All')).toBe('/admin/flows?q=sync');
		expect(href('Active')).toBe('/admin/flows?status=active&q=sync');
		expect(href('Disabled')).toBe('/admin/flows?status=disabled&q=sync');
		expect(getByRole('link', { name: 'Draft' }).getAttribute('aria-current')).toBe('page');
	});

	it('offers blocked in the status filter and draws a blocked flow in the warn tone with the reason on hover', () => {
		const { getByRole, container } = setup({ flows: [fixtureFlow, blockedFlow] });
		expect(getByRole('link', { name: 'Blocked' })).toBeTruthy();
		const rows = container.querySelectorAll('tbody tr');
		const pill = rows[1].querySelector('td:nth-child(3) [class*="rounded-full"]') as HTMLElement;
		expect(pill.textContent?.trim()).toBe('blocked');
		expect(pill.className).toContain('warn');
		expect(pill.className).not.toContain('danger');
		expect(rows[1].querySelector('[role="tooltip"]')?.textContent?.trim()).toBe(BLOCKED_TEXT);
		expect(rows[0].querySelector('[role="tooltip"]')).toBeNull();
		expect(rows[1].textContent).toContain('v2');
	});

	it('keeps the filter row on one height with the search named for the screen reader only', () => {
		const { getByTestId, getByLabelText, getByRole } = setup({ flows: [fixtureFlow] });
		const form = getByTestId('flow-filters');
		const search = getByLabelText('Search flows') as HTMLInputElement;
		expect(search.getAttribute('placeholder')).toBe('Name or slug');
		const label = form.querySelector('label[for="flow-search"]') as HTMLElement;
		expect(label.className).toContain('sr-only');
		// The status control sits at the control height, the field's own, so
		// the two share a middle instead of the control centering on a label.
		expect(getByRole('group', { name: 'Status' }).className).toContain('h-control');
		expect(form.querySelector('[role="toolbar"]')?.className).toContain('items-center');
	});

	it('lists validation errors the create action returned', () => {
		const { container } = render(FlowsPage, {
			props: {
				data: { flows: [], limit: 50, offset: 0, total: null, hasMore: false, status: '', q: '', locked: false, entitlements: licensed },
				form: {
					error: 'The definition did not validate.',
					errors: [
						{ node_id: 'join', path: '/config/left_key', message: 'required' },
						{ path: '/settings/timeout', message: 'not a duration' },
					] satisfies ValidationError[],
				},
			} as never,
		});
		expect(container.textContent).toContain('join /config/left_key: required');
		expect(container.textContent).toContain('/settings/timeout: not a duration');
		expect(container.textContent).not.toContain('undefined');
	});
});

describe('flows list row links', () => {
	it('carry the live filter so the editor can hand it back', () => {
		const { container } = setup({ flows: [fixtureFlow], status: 'draft', q: 'sync' });
		const link = container.querySelector(`tbody a[href^="/admin/flows/${fixtureFlow.id}"]`);
		expect(link?.getAttribute('href')).toBe(`/admin/flows/${fixtureFlow.id}?status=draft&q=sync`);
	});

	it('stay a clean path when nothing is filtered', () => {
		const { container } = setup({ flows: [fixtureFlow] });
		const link = container.querySelector(`tbody a[href^="/admin/flows/${fixtureFlow.id}"]`);
		expect(link?.getAttribute('href')).toBe(`/admin/flows/${fixtureFlow.id}`);
	});
});

describe('flows list page ceiling', () => {
	it('shows the refusal with the limit the plugin sent', () => {
		const { container } = render(FlowsPage, {
			props: {
				data: { flows: [], limit: 50, offset: 0, total: null, hasMore: false, status: '', q: '', locked: false, loadError: null, entitlements: licensed },
				form: { error: '7 of 7 flows are in use, the most this instance keeps. Delete one to make room for another.', refusal: { nodeIds: [], limit: 7, current: 7 } },
			} as never,
		});
		expect(container.textContent).toContain('Flow limit reached');
		expect(container.textContent).toContain('7 of 7 flows are in use');
	});
});

describe('flows list page role grants', () => {
	it('hides create and import when the list says the caller may not create', () => {
		const { queryByText } = setup({ flows: [fixtureFlow], canCreate: false });
		expect(queryByText('New flow')).toBeNull();
		expect(queryByText('Import')).toBeNull();
	});

	it('draws delete only on the flows whose actions carry it', () => {
		const other = { ...fixtureFlow, id: 'f2', slug: 'send-receipt', name: 'Send receipt', actions: ['read', 'delete'] };
		const { getByLabelText, queryByLabelText } = setup({ flows: [{ ...fixtureFlow, actions: ['read', 'update'] }, other] });
		expect(getByLabelText('Delete Send receipt')).toBeTruthy();
		expect(queryByLabelText(`Delete ${fixtureFlow.name}`)).toBeNull();
	});

	it('draws everything when the engine carries no grants', () => {
		const { getAllByText, getByTitle } = setup({ flows: [fixtureFlow] });
		expect(getAllByText('New flow').length).toBeGreaterThan(0);
		expect(getByTitle('Delete')).toBeTruthy();
	});

	it('renders a 403 inline as a role refusal', () => {
		const { container } = render(FlowsPage, {
			props: {
				data: { flows: [], limit: 50, offset: 0, total: null, hasMore: false, status: '', q: '', locked: false, loadError: null, entitlements: licensed, canCreate: true },
				form: { error: 'permission denied: create on flows', forbidden: true },
			} as never,
		});
		expect(container.textContent).toContain('Your role cannot do that');
		expect(container.textContent).toContain('create on flows');
	});
});
