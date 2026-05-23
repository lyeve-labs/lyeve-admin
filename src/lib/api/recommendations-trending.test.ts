import { describe, expect, it, vi } from 'vitest';
import type { HttpClient } from '@lyeve-labs/client';
import { INTEGRATION_EXAMPLE, readTrending } from './recommendations';

describe('readTrending', () => {
	it('reads the list the last recompute ranked, capped by the limit', async () => {
		const get = vi.fn(async () => ({ items: [{ content_id: 'a', title: 'A', slug: 'a', score: 3, view_count: 2 }] }));
		const client = { get } as unknown as HttpClient;
		expect(await readTrending(client, 5)).toHaveLength(1);
		expect(get).toHaveBeenCalledWith('/api/v1/recommendations/trending?limit=5');
	});

	it('reads an empty list as no items', async () => {
		const client = { get: vi.fn(async () => ({})) } as unknown as HttpClient;
		expect(await readTrending(client)).toEqual([]);
	});
});

describe('INTEGRATION_EXAMPLE', () => {
	it('names the four routes an application calls', () => {
		for (const route of ['/behavior', '/similar?content_id=', '/trending', '/feed']) expect(INTEGRATION_EXAMPLE).toContain(route);
	});
});
