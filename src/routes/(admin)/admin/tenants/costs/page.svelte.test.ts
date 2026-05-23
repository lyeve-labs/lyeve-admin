// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PageData } from './$types';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));

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

function data(overrides: Record<string, unknown> = {}): PageData {
	return { enabled: true, upgradeUrl: '', summary, dashboard, budgets, prices, ...overrides } as unknown as PageData;
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
		render(CostsPage, { props: { data: data({ summary: null }), form: null } });
		expect(screen.getByText('The split by resource did not answer.')).toBeTruthy();
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
