import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Cookies } from '@sveltejs/kit';

const api = vi.hoisted(() => ({
	search: vi.fn(),
	listSynonyms: vi.fn(),
	getRanking: vi.fn(),
}));

vi.mock('@lyeve-labs/client', () => ({ createClient: vi.fn(() => ({})) }));
vi.mock('@lyeve-labs/client-rest', () => api);

import { load } from './+page.server';

function mockCookies(): Cookies {
	return { get: vi.fn(() => 'tok') } as unknown as Cookies;
}

interface SearchLoadResult {
	results: unknown[];
	searchFailed: boolean;
}

// The load signature widens to `void` once the event is cast, so pin the shape here.
async function runLoad(q: string): Promise<SearchLoadResult> {
	const event = {
		fetch: vi.fn() as unknown as typeof globalThis.fetch,
		cookies: mockCookies(),
		url: new URL(`http://localhost/admin/search?q=${encodeURIComponent(q)}`),
		parent: async () => ({}),
	} as never;
	return (await load(event)) as unknown as SearchLoadResult;
}

beforeEach(() => {
	vi.clearAllMocks();
	api.listSynonyms.mockResolvedValue([]);
	api.getRanking.mockResolvedValue({ schema_name: '*', boost_rules: [] });
});

describe('admin/search/+page.server.ts load', () => {
	it('returns hits and no failure flag on success', async () => {
		api.search.mockResolvedValue({ results: [{ entry_id: 'e1' }] });

		const result = await runLoad('cats');

		expect(result.results).toEqual([{ entry_id: 'e1' }]);
		expect(result.searchFailed).toBe(false);
	});

	it('flags the failure instead of returning an empty result set', async () => {
		api.search.mockRejectedValue(new Error('search service down'));

		const result = await runLoad('cats');

		expect(result.searchFailed).toBe(true);
		expect(result.results).toEqual([]);
	});

	it('skips the search call and flags nothing when the query is empty', async () => {
		const result = await runLoad('');

		expect(api.search).not.toHaveBeenCalled();
		expect(result.searchFailed).toBe(false);
		expect(result.results).toEqual([]);
	});

	it('treats a missing results array as no hits, not a failure', async () => {
		api.search.mockResolvedValue({});

		const result = await runLoad('cats');

		expect(result.results).toEqual([]);
		expect(result.searchFailed).toBe(false);
	});
});
