import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Cookies } from '@sveltejs/kit';

const api = vi.hoisted(() => ({
	search: vi.fn(),
	listSynonyms: vi.fn(),
	getRanking: vi.fn(),
}));

vi.mock('@lyeve-labs/client', async (importOriginal) => ({
	...(await importOriginal<typeof import('@lyeve-labs/client')>()),
	createClient: vi.fn(() => ({})),
}));
vi.mock('@lyeve-labs/client-rest', () => api);

import { ApiError } from '@lyeve-labs/client';
import { load } from './+page.server';

function mockCookies(): Cookies {
	return { get: vi.fn(() => 'tok') } as unknown as Cookies;
}

type Read = { ok: true; value: unknown } | { ok: false; gate: { state: string } };

interface SearchLoadResult {
	results: Read | null;
	ranking: Read;
	synonyms: Read;
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
	it('returns the hits on success', async () => {
		api.search.mockResolvedValue({ results: [{ entry_id: 'e1' }] });

		const result = await runLoad('cats');

		expect(result.results).toEqual({ ok: true, value: [{ entry_id: 'e1' }] });
	});

	it('keeps a failed search as a gate instead of an empty result set', async () => {
		api.search.mockRejectedValue(new Error('search service down'));

		const result = await runLoad('cats');

		expect(result.results).toMatchObject({ ok: false, gate: { state: 'error' } });
	});

	it('skips the search call when the query is empty', async () => {
		const result = await runLoad('');

		expect(api.search).not.toHaveBeenCalled();
		expect(result.results).toBeNull();
	});

	it('treats a missing results array as no hits, not a failure', async () => {
		api.search.mockResolvedValue({});

		const result = await runLoad('cats');

		expect(result.results).toEqual({ ok: true, value: [] });
	});

	it('keeps a failed ranking read as a gate, never as the default weights', async () => {
		api.getRanking.mockRejectedValue(new ApiError(503, 'unavailable'));

		const result = await runLoad('');

		expect(result.ranking).toMatchObject({ ok: false, gate: { state: 'unavailable' } });
	});

	it('keeps a failed synonym read as a gate, never as no groups', async () => {
		api.listSynonyms.mockRejectedValue(new ApiError(500, 'internal'));

		const result = await runLoad('');

		expect(result.synonyms).toMatchObject({ ok: false, gate: { state: 'error' } });
	});
});
