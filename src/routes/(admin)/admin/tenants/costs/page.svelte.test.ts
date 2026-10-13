// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PageData } from './$types';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));

const kit = vi.hoisted(() => ({ confirm: vi.fn(async () => false) }));
vi.mock('@lyeve-labs/ui-kit', async (importOriginal) => {
	const actual = await importOriginal<Record<string, unknown>>();
	return { ...actual, confirm: kit.confirm };
});

import CostsPage from './+page.svelte';

afterEach(cleanup);

const summary = {
	total_amount: '12.50',
	currency: 'USD',
	database_cost: '0',
	storage_cost: '2.50',
	bandwidth_cost: '4.00',
	compute_cost: '6.00',
	ai_cost: '0',
	entry_count: 4,
};

const dashboard = {
	total_cost_this_month: '12.50',
	budgets_at_risk: [
		{ budget_id: 'b1', budget_name: 'Storage cap', threshold: 80, current_spend: '9.00', budget_amount: '10.00', spend_percent: 90, triggered: true },
	],
	open_anomalies: 1,
	active_recommendations: 0,
	potential_savings: '0',
};

const budgets = [
	{
		id: 'b1',
		name: 'Storage cap',
		resource_type: 'storage',
		period: 'monthly',
		amount: '10.00',
		currency: 'USD',
		alert_thresholds: [50, 80, 100],
		current_spend: '9.00',
		period_start: '2026-09-01T00:00:00Z',
		period_end: '2026-09-30T23:59:59Z',
	},
];

const prices = [
	{ resource_type: 'storage', unit_price: '0.05', per_units: 1073741824, currency: 'USD', source: 'tenant', updated_at: '2026-09-19T10:00:00Z' },
	{ resource_type: 'compute', unit_price: '1.00', per_units: 1000000, currency: 'USD', source: 'default', updated_at: null },
];

/** A read that answered. A null override is a read that failed for no reason the page can name. */
function read(value: unknown) {
	return value === null ? { ok: false, gate: { state: 'error', message: 'It could not be read.' } } : { ok: true, value };
}

function data(overrides: Record<string, unknown> = {}): PageData {
	const reads = { summary, dashboard, budgets, prices };
	const merged: Record<string, unknown> = { enabled: true, upgradeUrl: '', ...overrides };
	for (const key of Object.keys(reads) as (keyof typeof reads)[]) {
		const value = key in overrides ? overrides[key] : reads[key];
		merged[key] = value !== null && typeof value === 'object' && 'ok' in value ? value : read(value);
	}
	return merged as unknown as PageData;
}

function fieldsets(): HTMLFieldSetElement[] {
	return Array.from(document.querySelectorAll('fieldset'));
}

describe('tenant costs page', () => {
	it('renders the summary, the month, the budgets and the prices', () => {
		render(CostsPage, { props: { data: data(), form: null } });
		expect(screen.getByText('Beta')).toBeTruthy();
		expect(screen.getByText('12.50 USD')).toBeTruthy();
		expect(screen.getByTestId('cost-summary').textContent).toContain('USD');
		expect(screen.getByText('From 4 cost lines since the first of the month.')).toBeTruthy();
		expect(screen.getByTestId('cost-dashboard')).toBeTruthy();
		expect(screen.getByRole('list', { name: 'Budgets at risk' }).textContent).toContain('Storage cap');
		expect(screen.getByTestId('budget-row').textContent).toContain('50%, 80%, 100%');
		expect(screen.getByRole('button', { name: 'Delete Storage cap' })).toBeTruthy();
		expect(screen.getByText('Set by this tenant')).toBeTruthy();
		expect(screen.getByRole('button', { name: /Use default/ })).toBeTruthy();
		expect(screen.getAllByRole('form', { name: /Price for/ })).toHaveLength(5);
		expect(fieldsets().every((f) => !f.disabled)).toBe(true);
		expect(screen.getByRole('button', { name: /Aggregate now/ })).toHaveProperty('disabled', false);
		expect(screen.getByRole('button', { name: /New budget/ })).toHaveProperty('disabled', false);
		expect(screen.queryByTestId('not-enabled')).toBeNull();
	});

	it('shows only that the feature is not enabled when the ledger refused, and no control', () => {
		render(CostsPage, {
			props: { data: data({ enabled: false, summary: null, dashboard: null, budgets: null, prices: null }), form: null },
		});
		expect(screen.getByTestId('not-enabled').textContent).toContain('Not enabled on this instance.');
		expect(screen.queryByRole('region', { name: 'This month' })).toBeNull();
		expect(screen.queryByRole('region', { name: 'Budgets' })).toBeNull();
		expect(fieldsets()).toHaveLength(0);
		expect(screen.queryByRole('button', { name: /Aggregate now/ })).toBeNull();
		expect(screen.queryByRole('button', { name: /New budget/ })).toBeNull();
		expect(screen.queryByText('Beta')).toBeNull();
	});

	it('links where the refusal says the ledger is turned on, and only to a safe place', () => {
		render(CostsPage, {
			props: { data: data({ enabled: false, upgradeUrl: 'https://example.test/enable' }), form: null },
		});
		expect(screen.getByRole('link', { name: 'How to enable it' }).getAttribute('href')).toBe('https://example.test/enable');
		cleanup();
		render(CostsPage, {
			props: { data: data({ enabled: false, upgradeUrl: 'javascript:alert(1)' }), form: null },
		});
		expect(screen.getByTestId('not-enabled')).toBeTruthy();
		expect(screen.queryByRole('link', { name: 'How to enable it' })).toBeNull();
	});

	it('says which read did not answer', () => {
		render(CostsPage, {
			props: { data: data({ summary: { ok: false, gate: { state: 'unavailable' } } }), form: null },
		});
		expect(screen.getByText(/so the split by resource could not be read/)).toBeTruthy();
		expect(screen.getByTestId('cost-dashboard')).toBeTruthy();
	});

	it('reports the feed run and a refusal on the form it came from', () => {
		render(CostsPage, {
			props: {
				data: data(),
				form: { form: 'aggregate', saved: true, result: { tenant_id: 't', entries_saved: 3, budget_events: 1, anomalies: 0 } } as never,
			},
		});
		expect(screen.getByText('The feed ran')).toBeTruthy();
		expect(screen.getByText(/3 cost lines written, 1 budget events published/)).toBeTruthy();
		cleanup();
		render(CostsPage, {
			props: { data: data(), form: { form: 'price', error: 'The cost ledger is not enabled on this instance.', locked: true } as never },
		});
		expect(screen.getAllByText('The cost ledger is not enabled on this instance.')).toHaveLength(1);
	});
});

/*
 * A price card states what this tenant pays per block of units. Drawn with no
 * price read, every card claimed the default at 0 USD and offered to save it.
 */
describe('tenant cost prices that are not known', () => {
	it('draws no price card when the prices could not be read', () => {
		render(CostsPage, {
			props: { data: data({ prices: { ok: false, gate: { state: 'unavailable' } } }), form: null },
		});
		expect(screen.queryByTestId('cost-prices')).toBeNull();
		expect(screen.queryAllByRole('form', { name: /Price for/ })).toHaveLength(0);
		expect(screen.queryByText('Default')).toBeNull();
		expect(screen.getByText(/so the prices could not be read/)).toBeTruthy();
	});

});

/*
 * Every form on the page shares one action result. The budget drawer showed
 * nothing of a failed create, and a failed delete is no failure of the next
 * budget opened.
 */
describe('the budget drawer and the failures of other actions', () => {
	const drawerText = () => document.body.querySelector('form#budget-form')?.textContent ?? '';

	it('leaves a newly opened budget drawer clean after a failed delete', async () => {
		render(CostsPage, { props: { data: data(), form: { form: 'budget', error: 'Failed to delete the budget.', locked: false } as never } });
		expect(screen.getAllByText('Failed to delete the budget.')).toHaveLength(1);
		await fireEvent.click(screen.getAllByRole('button', { name: /New budget/ })[0]);
		expect(drawerText()).not.toContain('Failed to delete the budget.');
	});

	it('keeps the warn tone of a refusal for a ledger that is not enabled', async () => {
		const { rerender } = render(CostsPage, { props: { data: data(), form: null } });
		await fireEvent.click(screen.getAllByRole('button', { name: /New budget/ })[0]);
		await rerender({
			data: data(),
			form: { form: 'budget-new', error: 'The cost ledger is not enabled on this instance.', locked: true } as never,
		});
		const form = document.body.querySelector('form#budget-form') as HTMLFormElement;
		const alert = [...form.querySelectorAll('[role="alert"], [role="status"], div')].find(
			(el) => el.textContent?.trim() === 'The cost ledger is not enabled on this instance.' && el.className.includes('warn'),
		);
		expect(alert).toBeTruthy();
		expect(form.textContent).toContain('The cost ledger is not enabled on this instance.');
	});

	it('shows a failed create inside the open drawer, first in its form', async () => {
		const { rerender } = render(CostsPage, { props: { data: data(), form: null } });
		await fireEvent.click(screen.getAllByRole('button', { name: /New budget/ })[0]);
		await rerender({ data: data(), form: { form: 'budget-new', error: 'The amount is a decimal.', locked: false } as never });
		const form = document.body.querySelector('form#budget-form') as HTMLFormElement;
		expect(form.firstElementChild?.textContent).toContain('The amount is a decimal.');
	});
});

describe('the budget controls', () => {
	it('picks the period from a segmented control that posts it', async () => {
		render(CostsPage, { props: { data: data(), form: null } });
		await fireEvent.click(screen.getAllByRole('button', { name: /New budget/ })[0]);
		expect(screen.getByRole('radiogroup', { name: 'Period' })).toBeTruthy();
		const form = document.body.querySelector('form#budget-form') as HTMLFormElement;
		expect(new FormData(form).get('period')).toBe('monthly');
	});

	it('names the budget in the delete confirmation and posts its id once agreed', async () => {
		kit.confirm.mockResolvedValue(true);
		render(CostsPage, { props: { data: data(), form: null } });
		const form = document.body.querySelector('form[action="?/deleteBudget"]') as HTMLFormElement;
		const submit = vi.spyOn(form, 'requestSubmit').mockImplementation(() => {});
		await fireEvent.click(screen.getByRole('button', { name: 'Delete Storage cap' }));
		await vi.waitFor(() => expect(submit).toHaveBeenCalled());
		expect(kit.confirm).toHaveBeenCalledWith('Delete budget Storage cap', expect.any(String), { confirmLabel: 'Delete' });
		expect(new FormData(form).get('id')).toBe('b1');
	});
});
