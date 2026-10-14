import { describe, expect, it, vi } from 'vitest';
import type { HttpClient } from '@lyeve-labs/client';
import { listBudgets } from './cost';

const budget = (i: number) => ({ id: `b${i}`, name: `Budget ${i}`, period: 'monthly', amount: '1', currency: 'USD' });

describe('listBudgets', () => {
	// The plugin pages at most 200 budgets at a time and states the count, so
	// one read of the first page drew the rest as missing.
	it('walks every page up to the stated count', async () => {
		const get = vi.fn(async (url: string) => {
			const offset = Number(new URL(url, 'http://x').searchParams.get('offset'));
			const size = offset === 0 ? 200 : 30;
			return { data: Array.from({ length: size }, (_, i) => budget(offset + i)), total_count: 230 };
		});
		const rows = await listBudgets({ get } as unknown as HttpClient);
		expect(rows).toHaveLength(230);
		expect(get).toHaveBeenCalledTimes(2);
		expect(get.mock.calls[1][0]).toContain('offset=200');
	});

	it('stops after one short page', async () => {
		const get = vi.fn(async () => ({ data: [budget(0)], total_count: 1 }));
		expect(await listBudgets({ get } as unknown as HttpClient)).toHaveLength(1);
		expect(get).toHaveBeenCalledTimes(1);
	});
});
