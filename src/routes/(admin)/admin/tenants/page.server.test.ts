import { describe, it, expect, vi } from 'vitest';
import type { Cookies } from '@sveltejs/kit';

import { actions, load } from './+page.server';

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

function tenants(count: number, from = 0) {
	return Array.from({ length: count }, (_, i) => ({
		id: `t${from + i}`,
		slug: `tenant-${from + i}`,
		name: `Tenant ${from + i}`,
		plan: 'example',
		enabled: true,
		archived: false,
		created_at: '2026-01-01T00:00:00Z',
		updated_at: '2026-01-01T00:00:00Z',
	}));
}

/** A load event whose fetch answers with `body` and records the URL asked for. */
function loadEvent(body: unknown, search = '') {
	const seen: string[] = [];
	const fetch = vi.fn(async (url: string) => {
		seen.push(String(url));
		return json(body);
	}) as unknown as typeof globalThis.fetch;

	return {
		seen,
		event: {
			fetch,
			cookies: mockCookies(),
			url: new URL(`http://localhost/admin/tenants${search}`),
			parent: async () => ({ user: { roles: ['super_admin'] } }),
		} as never,
	};
}

/**
 * The load's declared return includes void, because the 403 path returns
 * through error(). Every case here is a success path, so the result is narrowed
 * once rather than at each assertion.
 */
type Loaded = Exclude<Awaited<ReturnType<typeof load>>, void>;
const run = async (event: never): Promise<Loaded> => (await load(event)) as Loaded;

describe('admin/tenants load', () => {
	// The envelope carries total_count, and without it the page would
	// describe one server page as the whole instance.
	it('surfaces the count the API already returned', async () => {
		const { event } = loadEvent({ data: tenants(50), total_count: 731 });

		const result = await run(event);

		expect(result.total).toBe(731);
		expect(result.tenants).toHaveLength(50);
	});

	it('defaults to the engine page size and the first page', async () => {
		const { event, seen } = loadEvent({ data: tenants(50), total_count: 731 });

		const result = await run(event);

		expect(result.limit).toBe(50);
		expect(result.offset).toBe(0);
		expect(seen[0]).toContain('limit=50');
		expect(seen[0]).toContain('offset=0');
	});

	it('carries the requested page through to the engine', async () => {
		const { event, seen } = loadEvent({ data: tenants(50, 100), total_count: 731 }, '?limit=50&offset=100');

		const result = await run(event);

		expect(result.offset).toBe(100);
		expect(seen[0]).toContain('offset=100');
	});

	// Asking past the engine's ceiling comes back clamped with nothing saying
	// so, which is a short page the caller reads as the end of the collection.
	it('never asks for more rows than the engine will serve', async () => {
		const { event, seen } = loadEvent({ data: tenants(500), total_count: 731 }, '?limit=5000');

		const result = await run(event);

		expect(result.limit).toBe(500);
		expect(seen[0]).toContain('limit=500');
	});

	it('refuses a negative offset rather than passing it on', async () => {
		const { event } = loadEvent({ data: tenants(50), total_count: 731 }, '?offset=-10');

		const result = await run(event);

		expect(result.offset).toBe(0);
	});

	// A response that omits the count would otherwise report fewer tenants than
	// the reader has already paged past.
	it('keeps what has been read as the floor under a missing count', async () => {
		const { event } = loadEvent({ data: tenants(50, 700) }, '?limit=50&offset=700');

		const result = await run(event);

		expect(result.total).toBe(750);
	});

	it('renders an empty page when the engine cannot be reached', async () => {
		const fetch = vi.fn(async () => {
			throw new Error('engine unreachable');
		}) as unknown as typeof globalThis.fetch;

		const result = await run({
			fetch,
			cookies: mockCookies(),
			url: new URL('http://localhost/admin/tenants'),
			parent: async () => ({ user: { roles: ['super_admin'] } }),
		} as never);

		expect(result.tenants).toEqual([]);
		expect(result.total).toBe(0);
	});

	it('throws 403 for anyone but a super_admin', async () => {
		const { event } = loadEvent({ data: [], total_count: 0 });

		await expect(
			load({
				...(event as object),
				parent: async () => ({ user: { roles: ['admin'] } }),
			} as never)
		).rejects.toThrow();
	});
});

/*
 * Each refused rule marks the control it is about, so the operator never has
 * to work out which of two controls a single banner meant.
 */
describe('admin/tenants/+page.server.ts actions.create', () => {
	function createEvent(fields: Record<string, string>) {
		const form = new FormData();
		for (const [key, value] of Object.entries(fields)) form.append(key, value);
		// requireRole reads the session through getMe before the action runs, so
		// the event's own fetch has to answer that call for the validation below
		// to be what is under test.
		const fetch = vi.fn(async () =>
			json({ id: 'u1', email: 'admin@b.co', roles: ['super_admin'] })
		) as unknown as typeof globalThis.fetch;

		return {
			request: { formData: async () => form },
			fetch,
			cookies: mockCookies(),
			url: new URL('http://localhost/admin/tenants'),
		} as never;
	}

	it('names the control that was rejected', async () => {
		const result = await actions.create(createEvent({ name: 'ACME Corp' }));

		expect(result).toEqual({
			status: 400,
			data: {
				error: 'Check the highlighted fields.',
				fields: { slug: 'Slug is required' },
			},
		});
	});

	it('names both controls when both were rejected', async () => {
		const result = await actions.create(createEvent({}));

		expect(result).toEqual({
			status: 400,
			data: {
				error: 'Check the highlighted fields.',
				fields: { slug: 'Slug is required', name: 'Display name is required' },
			},
		});
	});

	it('treats whitespace as absent', async () => {
		const result = await actions.create(createEvent({ slug: '   ', name: 'ACME Corp' }));

		expect(result).toMatchObject({ data: { fields: { slug: 'Slug is required' } } });
	});

	/** The body the action posted to create the tenant. */
	function sentBody(event: unknown): Record<string, unknown> {
		const calls = (event as { fetch: { mock: { calls: [unknown, RequestInit | undefined][] } } }).fetch.mock.calls;
		const post = calls.find(([, init]) => init?.method === 'POST');
		return JSON.parse(String(post?.[1]?.body));
	}

	it('leaves the plan to the engine when none is typed', async () => {
		const event = createEvent({ slug: 'acme', name: 'ACME Corp', plan: '  ' });
		await actions.create(event);

		expect(sentBody(event)).not.toHaveProperty('plan');
	});

	it('sends the plan as typed', async () => {
		const event = createEvent({ slug: 'acme', name: 'ACME Corp', plan: 'standard' });
		await actions.create(event);

		expect(sentBody(event).plan).toBe('standard');
	});
});

describe('admin/tenants load provisioning', () => {
	function eventFor(provisioning: () => Response) {
		const fetch = vi.fn(async (url: string) =>
			String(url).includes('/tenants/provisioning') ? provisioning() : json({ data: tenants(1), total_count: 1 })
		) as unknown as typeof globalThis.fetch;
		return {
			fetch,
			cookies: mockCookies(),
			url: new URL('http://localhost/admin/tenants'),
			parent: async () => ({ user: { roles: ['super_admin'] } }),
		} as never;
	}

	it('takes from the plugin whether a tenant may be created', async () => {
		expect((await run(eventFor(() => json({ enabled: true })))).canProvision).toBe(true);
		expect((await run(eventFor(() => json({ enabled: false })))).canProvision).toBe(false);
	});

	it('reads a plugin without the route, or a failed read, as not enabled', async () => {
		expect((await run(eventFor(() => json({ error: 'not found' }, 404))))).toMatchObject({ canProvision: false, total: 1 });
		expect((await run(eventFor(() => json({ error: 'unavailable' }, 503))))).toMatchObject({ canProvision: false, total: 1 });
	});
});
