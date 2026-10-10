import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Cookies } from '@sveltejs/kit';

vi.mock('$lib/server/authz', () => ({
	requireUser: vi.fn(async () => ({ id: 'u1' })),
	authedClient: vi.fn(() => ({ delete: vi.fn() })),
}));

vi.mock('@lyeve-labs/client', () => ({ createClient: vi.fn(() => ({})) }));

const rest = vi.hoisted(() => ({
	getSchemas: vi.fn(async () => [{ name: 'posts', display_name: 'Posts' }]),
	getSchema: vi.fn(async () => ({ name: 'posts', display_name: 'Posts', fields: [] })),
}));
vi.mock('@lyeve-labs/client-rest', () => rest);

import { load } from './+page.server';

/**
 * The load's own return type is widened by the framework to include void, so
 * every read of a returned field trips the type checker. The shape asserted
 * here is the one the page consumes.
 */
type Loaded = {
	items: unknown[];
	limit: number;
	offset: number;
	total: number;
};

function mockCookies(initial: Record<string, string> = {}): Cookies {
	return {
		get: vi.fn((name: string) => initial[name] ?? undefined),
		set: vi.fn(),
		delete: vi.fn(),
		getAll: vi.fn(() => []),
		serialize: vi.fn(() => ''),
	} as unknown as Cookies;
}

function rows(count: number, from = 0) {
	return Array.from({ length: count }, (_, i) => ({
		id: `e${from + i}`,
		title: `Entry ${from + i}`,
		body: { headline: `h${from + i}` },
		status: 'published',
		created_at: '2026-01-01T00:00:00Z',
		updated_at: '2026-01-02T00:00:00Z',
	}));
}

async function runLoad(query: string, body: unknown) {
	const fetch = vi.fn(
		async () =>
			new Response(JSON.stringify(body), {
				status: 200,
				headers: { 'content-type': 'application/json' },
			}),
	);
	const result = (await load({
		fetch,
		cookies: mockCookies({ '__Host-sys_session': 'tok' }),
		params: { schema: 'posts' },
		url: new URL(`http://localhost/admin/content/posts${query}`),
	} as never)) as unknown as Loaded;
	return { fetch, result };
}

/** The `limit=` value of the single content listing request the load makes. */
function requestedLimit(fetch: { mock: { calls: unknown[][] } }): number {
	const requested = new URL(String(fetch.mock.calls[0][0]), 'http://localhost');
	return Number(requested.searchParams.get('limit'));
}

// The engine answers list endpoints through httpx.Paginated, whose envelope is
// {"data", "total_count", "limit", "offset"}. The load keeps the count, because
// items.length is the size of the page rather than of the collection.
describe('content listing reads the collection total from the envelope', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('takes total from total_count, not from the number of rows', async () => {
		const { result } = await runLoad('?limit=100', {
			data: rows(100),
			total_count: 4000,
			limit: 100,
			offset: 0,
		});

		expect(result.total).toBe(4000);
		expect(result.items).toHaveLength(100);
	});

	it('keeps the envelope total on a later page', async () => {
		const { result } = await runLoad('?limit=100&offset=300', {
			data: rows(100, 300),
			total_count: 4000,
			limit: 100,
			offset: 300,
		});

		expect(result.total).toBe(4000);
		expect(result.offset).toBe(300);
	});

	it('never reports a total below the rows already paged past', async () => {
		// A response carrying no count would otherwise fall back to the page
		// length, which is smaller than the offset the reader already passed.
		const { result } = await runLoad('?limit=100&offset=300', { data: rows(100, 300) });

		expect(result.total).toBe(400);
	});

	it('reports an empty collection when the listing fails', async () => {
		const fetch = vi.fn(async () => new Response('nope', { status: 503 }));
		const result = (await load({
			fetch,
			cookies: mockCookies({ '__Host-sys_session': 'tok' }),
			params: { schema: 'posts' },
			url: new URL('http://localhost/admin/content/posts'),
		} as never)) as unknown as Loaded;

		expect(result.items).toEqual([]);
		expect(result.total).toBe(0);
	});
});

// reqparse.MaxPageLimit is 500 and ParsePagination clamps an over-limit request
// rather than rejecting it, so asking for more comes back silently truncated.
describe('content listing clamps the page size to the server maximum', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('clamps a request above the server maximum to 500', async () => {
		const { fetch, result } = await runLoad('?limit=1000', {
			data: rows(500),
			total_count: 4000,
		});

		expect(requestedLimit(fetch)).toBe(500);
		expect(result.limit).toBe(500);
	});

	it('asks for exactly the limit, with no has-more probe row', async () => {
		const { fetch, result } = await runLoad('?limit=100', { data: rows(100), total_count: 4000 });

		expect(requestedLimit(fetch)).toBe(100);
		expect(result.items).toHaveLength(100);
	});

	it('asks for exactly 500 at the top of the range, never 501', async () => {
		// A limit+1 probe here would ask for 501, which the server clamps to
		// 500. A full page would then look short and report no next page.
		const { fetch } = await runLoad('?limit=500', { data: rows(500), total_count: 4000 });

		expect(requestedLimit(fetch)).toBe(500);
	});

	it('falls back to 100 when no limit is given', async () => {
		const { fetch, result } = await runLoad('', { data: rows(100), total_count: 4000 });

		expect(requestedLimit(fetch)).toBe(100);
		expect(result.limit).toBe(100);
	});

	it('floors a negative limit at one, so no request carries a negative page size', async () => {
		const { fetch, result } = await runLoad('?limit=-5', { data: rows(1), total_count: 4000 });

		expect(requestedLimit(fetch)).toBe(1);
		expect(result.limit).toBe(1);
	});
});

// A link to an author is stored as the author's id. The table shows the
// author's title instead, read once for the linked content type.
describe('content listing names linked entries', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('replaces a linked id with the linked entry and its title', async () => {
		rest.getSchema.mockResolvedValueOnce({
			name: 'posts',
			display_name: 'Posts',
			fields: [
				{ name: 'headline', field_type: 'text' },
				{ name: 'author', field_type: 'relation', relation_type: 'belongs_to', relation_to: 'author' },
			],
		} as never);
		const posts = {
			data: [
				{ ...rows(1)[0], body: { headline: 'h', author: 'a1' } },
				{ ...rows(1, 1)[0], body: { headline: 'h', author: 'missing' } },
			],
			total_count: 2,
		};
		const authors = { data: [{ id: 'a1', title: 'Ada Park', created_at: '', updated_at: '' }], total_count: 1 };
		const fetch = vi.fn(async (input: string | URL | Request) => {
			const u = new URL(String(input), 'http://localhost');
			const body = u.searchParams.get('schema') === 'author' ? authors : posts;
			return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
		});
		const result = (await load({
			fetch,
			cookies: mockCookies({ '__Host-sys_session': 'tok' }),
			params: { schema: 'posts' },
			url: new URL('http://localhost/admin/content/posts'),
		} as never)) as unknown as { items: { data: Record<string, unknown> }[] };

		expect(result.items[0].data.author).toEqual({ id: 'a1', title: 'Ada Park' });
		expect(result.items[1].data.author).toBe('missing');
		const authorReads = fetch.mock.calls.filter((c) => String(c[0]).includes('schema=author'));
		expect(authorReads).toHaveLength(1);
	});

	it('reads nothing more when no row links anywhere', async () => {
		const { fetch } = await runLoad('', { data: rows(3), total_count: 3 });
		expect(fetch).toHaveBeenCalledTimes(1);
	});
});
