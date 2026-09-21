import { describe, expect, it } from 'vitest';
import { parseBudget, parsePrice } from './forms';

function form(fields: Record<string, string>): FormData {
	const f = new FormData();
	for (const [k, v] of Object.entries(fields)) f.set(k, v);
	return f;
}

describe('parseBudget', () => {
	it('builds the request the ledger takes, with the window as whole days in UTC', () => {
		const parsed = parseBudget(
			form({ name: 'Storage cap', amount: '10.50', period: 'monthly', resource_type: 'storage', currency: 'usd', alert_thresholds: '50, 90', period_start: '2026-09-01', period_end: '2026-09-30' }),
		);
		expect(parsed).toEqual({
			budget: {
				name: 'Storage cap',
				resource_type: 'storage',
				period: 'monthly',
				amount: '10.50',
				currency: 'USD',
				alert_thresholds: [50, 90],
				period_start: '2026-09-01T00:00:00.000Z',
				period_end: '2026-09-30T23:59:59.000Z',
			},
		});
	});

	it('defaults the thresholds and the currency and takes every resource', () => {
		const parsed = parseBudget(form({ name: 'All', amount: '100', period: 'annual', period_start: '2026-01-01', period_end: '2026-12-31' }));
		expect('budget' in parsed && parsed.budget.alert_thresholds).toEqual([50, 80, 100]);
		expect('budget' in parsed && parsed.budget.currency).toBe('USD');
		expect('budget' in parsed && parsed.budget.resource_type).toBeNull();
	});

	it('names the control that is wrong', () => {
		const base = { name: 'x', amount: '1', period: 'monthly', period_start: '2026-09-01', period_end: '2026-09-30' };
		expect(parseBudget(form({ ...base, name: '' }))).toEqual({ error: 'The budget needs a name.' });
		expect(parseBudget(form({ ...base, amount: 'ten' }))).toEqual({ error: 'The amount is a decimal number, such as 250 or 99.50.' });
		expect(parseBudget(form({ ...base, period: 'weekly' }))).toEqual({ error: 'Pick a period: monthly, quarterly or annual.' });
		expect(parseBudget(form({ ...base, resource_type: 'gpu' }))).toEqual({ error: 'Pick a resource type, or leave it for every resource.' });
		expect(parseBudget(form({ ...base, alert_thresholds: '50, high' }))).toEqual({
			error: 'Alert thresholds are whole percentages, comma separated, such as 50, 80, 100.',
		});
		expect(parseBudget(form({ ...base, period_end: '2026-08-01' }))).toEqual({ error: 'The window ends before it starts.' });
		expect(parseBudget(form({ ...base, period_start: '' }))).toEqual({ error: 'Pick the first and last day of the budget window.' });
	});
});

describe('parsePrice', () => {
	it('builds the price for one resource', () => {
		expect(parsePrice(form({ resource_type: 'bandwidth', unit_price: '0.09', per_units: '1073741824', currency: 'eur' }))).toEqual({
			resourceType: 'bandwidth',
			price: { unit_price: '0.09', per_units: 1073741824, currency: 'EUR' },
		});
	});

	it('refuses what the ledger would refuse', () => {
		expect(parsePrice(form({ resource_type: 'gpu', unit_price: '1', per_units: '1' }))).toEqual({ error: 'Pick a resource type.' });
		expect(parsePrice(form({ resource_type: 'ai', unit_price: '-1', per_units: '1' }))).toEqual({ error: 'The unit price is a decimal number, such as 0.09.' });
		expect(parsePrice(form({ resource_type: 'ai', unit_price: '1', per_units: '0' }))).toEqual({ error: 'The block is a whole number of units, at least 1.' });
	});
});
