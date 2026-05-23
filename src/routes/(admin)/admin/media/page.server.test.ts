import { describe, it, expect, vi } from 'vitest';
import type { Cookies } from '@sveltejs/kit';

import { load } from './+page.server';

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' },
	});
}

function mockCookies(): Cookies {
	return {
		get: vi.fn(() => 'tok'),
		set: vi.fn(),
		delete: vi.fn(),
		getAll: vi.fn(() => []),
		serialize: vi.fn(() => ''),
	} as unknown as Cookies;
}

function files(count: number, from = 0) {
	return Array.from({ length: count }, (_, i) => ({
		id: `m${from + i}`,
		key: `k${from + i}`,
		filename: `file-${from + i}.png`,
		content_type: 'image/png',
		size: 1024,
		alt_text: '',
		folder: '',
		uploaded_by: 'u1',
		created_at: '2026-01-01T00:00:00Z',
	}));
}

/** A load event whose fetch answers with `body` and records the URL asked for. */
function loadEvent(body: unknown, search = '') {
	const seen: string[] = [];
	const inits: RequestInit[] = [];
	const fetch = vi.fn(async (url: string, init?: RequestInit) => {
		seen.push(String(url));
		inits.push(init ?? {});
		return json(body);
	}) as unknown as typeof globalThis.fetch;

	return {
		seen,
		inits,
		event: {
			fetch,
			cookies: mockCookies(),
			url: new URL(`http://localhost/admin/media${search}`),
			parent: async () => ({ user: { roles: ['super_admin'] } }),
		} as never,
	};
}

type Loaded = Exclude<Awaited<ReturnType<typeof load>>, void>;

/*
 * The request always carries a limit and an offset. A library of ten thousand
 * files is a page the browser cannot lay out, and an operator could not reach
 * the end of it either.
 */
describe('admin/media/+page.server.ts load', () => {
	it('asks the endpoint for a bounded window', async () => {
		const { seen, event } = loadEvent(files(10));

		await load(event);

		expect(seen[0]).toContain('limit=');
		expect(seen[0]).toContain('offset=0');
	});

	it('carries the window the request named', async () => {
		const { seen, event } = loadEvent(files(10), '?limit=10&offset=40');

		const result = (await load(event)) as Loaded;

		expect(seen[0]).toContain('offset=40');
		expect(result.limit).toBe(10);
		expect(result.offset).toBe(40);
	});

	// The probe row answers "is there another page" against an endpoint that
	// states no count. It is never rendered.
	it('keeps the probe row out of the grid', async () => {
		const { event } = loadEvent(files(61), '?limit=60');

		const result = (await load(event)) as Loaded;

		expect(result.items).toHaveLength(60);
		expect(result.hasMore).toBe(true);
	});

	it('reports the end of the library when no probe row came back', async () => {
		const { event } = loadEvent(files(12), '?limit=60');

		const result = (await load(event)) as Loaded;

		expect(result.items).toHaveLength(12);
		expect(result.hasMore).toBe(false);
	});

	// An endpoint that ignores the window still gets bounded, because the slice
	// happens on this side of the call.
	it('bounds a response that ignored the window', async () => {
		const { event } = loadEvent(files(10_000), '?limit=60');

		const result = (await load(event)) as Loaded;

		expect(result.items).toHaveLength(60);
	});

	it('states a total only when the endpoint sent one', async () => {
		const bare = loadEvent(files(10));
		expect(((await load(bare.event)) as Loaded).total).toBeNull();

		const counted = loadEvent({ data: files(10), total_count: 4210 });
		expect(((await load(counted.event)) as Loaded).total).toBe(4210);
	});

	it('renders an empty library rather than failing when the endpoint errors', async () => {
		const fetch = vi.fn(async () => json({ error: 'nope' }, 500)) as unknown as typeof globalThis.fetch;
		const event = {
			fetch,
			cookies: mockCookies(),
			url: new URL('http://localhost/admin/media'),
			parent: async () => ({ user: { roles: ['super_admin'] } }),
		} as never;

		const result = (await load(event)) as Loaded;

		expect(result.items).toEqual([]);
		expect(result.hasMore).toBe(false);
	});

	/*
	 * The empty state says the library has nothing in it and carries no control
	 * to leave with, so an offset past the end would tell an operator their
	 * files are gone and strand them there. Asserted against the loader rather
	 * than the arithmetic behind it: a correction nothing calls is a correction
	 * that does not happen.
	 */
	it('sends a request past the end back to the last page that has rows', async () => {
		const { event } = loadEvent(
			{ data: [], total_count: 45 },
			'?limit=20&offset=200&folder=logos'
		);

		// rejects rather than a caught value: a load that returned instead of
		// correcting would satisfy any assertion written about what it threw.
		// The folder survives the correction, because rebuilding the query from a
		// named list of parameters is how a corrected page loses the filter it
		// was being corrected within.
		await expect(load(event)).rejects.toMatchObject({
			status: 307,
			location: '/admin/media?limit=20&offset=40&folder=logos'
		});
	});

	it('renders an empty library rather than correcting it', async () => {
		const { event } = loadEvent({ data: [], total_count: 0 });
		const result = (await load(event)) as Loaded;
		expect(result.items).toEqual([]);
	});

	// The list route has no text filter, so a search is a different request
	// with a different answer shape, and the page has to read both alike.
	describe('with a search term', () => {
		it('asks the search endpoint, newest first, for the same window', async () => {
			const { seen, inits, event } = loadEvent({ items: files(3), total: 3 }, '?q=invoice&limit=10');

			const result = (await load(event)) as Loaded;

			expect(seen[0]).toContain('/api/admin/media/search');
			expect(inits[0]?.method).toBe('POST');
			const sent = JSON.parse(String(inits[0]?.body)) as Record<string, unknown>;
			expect(sent.query).toBe('invoice');
			expect(sent.limit).toBe(11);
			expect(sent.offset).toBe(0);
			expect(sent.sort_by).toBe('created_at');
			expect(sent.sort_desc).toBe(true);
			expect(result.items).toHaveLength(3);
			expect(result.total).toBe(3);
			expect(result.q).toBe('invoice');
		});

		it('keeps the list route when the term is blank', async () => {
			const { seen, event } = loadEvent(files(2), '?q=%20%20');

			const result = (await load(event)) as Loaded;

			expect(seen[0]).toContain('/api/admin/media?');
			expect(result.q).toBe('');
		});

		it('renders an empty library rather than failing when the search errors', async () => {
			const fetch = vi.fn(async () => json({ error: 'search failed' }, 503)) as unknown as typeof globalThis.fetch;
			const event = {
				fetch,
				cookies: mockCookies(),
				url: new URL('http://localhost/admin/media?q=x'),
				parent: async () => ({ user: { roles: ['super_admin'] } }),
			} as never;

			const result = (await load(event)) as Loaded;

			expect(result.items).toEqual([]);
		});
	});
});
