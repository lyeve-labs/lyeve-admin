import { describe, expect, it, vi } from 'vitest';
import type { HttpClient } from '@lyeve-labs/client';
import { costShares, getSummary, monthStart } from './cost';

const summary = (over: Record<string, string> = {}) => ({
	total_amount: '10', currency: 'USD', database_cost: '1', storage_cost: '6', bandwidth_cost: '0',
	compute_cost: '3', ai_cost: '0', entry_count: 4, ...over,
});

describe('costShares', () => {
	it('breaks the total down by resource, largest first', () => {
		expect(costShares(summary())).toEqual([
			{ label: 'Storage', amount: '6', percent: 60 },
			{ label: 'Compute', amount: '3', percent: 30 },
			{ label: 'Database', amount: '1', percent: 10 },
			{ label: 'Bandwidth', amount: '0', percent: 0 },
			{ label: 'AI', amount: '0', percent: 0 },
		]);
	});

	it('gives every share zero on a month that cost nothing', () => {
		expect(costShares(summary({ total_amount: '0', storage_cost: '0', compute_cost: '0', database_cost: '0' })).every((s) => s.percent === 0)).toBe(true);
	});
});

describe('the month the summary covers', () => {
	it('starts at the first of the month in UTC', () => {
		expect(monthStart(new Date('2026-09-26T13:05:00Z')).toISOString()).toBe('2026-09-01T00:00:00.000Z');
	});

	it('asks the ledger for lines from that start', async () => {
		const get = vi.fn(async () => summary());
		await getSummary({ get } as unknown as HttpClient, new Date('2026-09-01T00:00:00Z'));
		expect(get).toHaveBeenCalledWith('/api/admin/cost-monitor/summary?from=2026-09-01T00%3A00%3A00Z');
	});
});
