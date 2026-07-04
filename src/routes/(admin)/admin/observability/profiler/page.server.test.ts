import { describe, expect, it, vi } from 'vitest';
import type { Cookies } from '@sveltejs/kit';
import { actions, load } from './+page.server';

type Loaded = Exclude<Awaited<ReturnType<typeof load>>, void>;

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function mockCookies(): Cookies {
	return { get: vi.fn(() => 'tok'), set: vi.fn(), delete: vi.fn(), getAll: vi.fn(() => []), serialize: vi.fn(() => '') } as unknown as Cookies;
}

type Route = (url: string, init?: RequestInit) => Response;

function fetchFor(routes: Record<string, Route>, roles: string[]) {
	const calls: { url: string; init?: RequestInit }[] = [];
	const fetch = vi.fn(async (url: string, init?: RequestInit) => {
		const asked = String(url);
		calls.push({ url: asked, init });
		if (asked.includes('/auth/me')) return json({ id: 'u1', roles, disabled: false });
		for (const [needle, route] of Object.entries(routes)) if (asked.includes(needle)) return route(asked, init);
		return json({ error: 'no route' }, 404);
	}) as unknown as typeof globalThis.fetch;
	return { fetch, calls };
}

const STATS = {
	endpoint: '/api/v1/content',
	method: 'GET',
	count: 4,
	avg_duration_ns: 1_500_000,
	p50_duration_ns: 1_000_000,
	p95_duration_ns: 2_000_000,
	p99_duration_ns: 3_000_000,
	max_duration_ns: 4_000_000,
	avg_alloc_bytes: 2048,
	total_alloc_bytes: 8192,
	last_seen: '2026-09-21T10:00:00Z',
};

const MEMORY = {
	snapshots: [{ timestamp: '2026-09-21T10:00:00Z', heap_alloc: 1024, heap_objects: 10, total_alloc: 4096, num_gc: 2, num_goroutine: 30 }],
	slope_bytes_per_sec: 0,
	leak_likely: false,
};

const DETAIL = { endpoint: '/api/v1/content', methods: [{ method: 'GET', count: 4, stats: STATS, recent_entries: [] }], total_count: 4, limit: 100, offset: 0 };

const views: Record<string, Route> = {
	'/debug/profiler/endpoints': () => json({ endpoints: [STATS], count: 1 }),
	'/debug/profiler/slowest': () => json({ slowest: [STATS] }),
	'/debug/profiler/plugins': () => json({ plugins: [{ plugin: 'core', count: 4, avg_duration_ns: 1, max_duration_ns: 2, total_alloc_bytes: 3 }] }),
	'/debug/profiler/memory': () => json(MEMORY),
	'/debug/profiler/endpoint/api/v1/content': () => json(DETAIL),
};

function loadEvent(routes: Record<string, Route>, roles: string[], search = '') {
	const { fetch, calls } = fetchFor(routes, roles);
	return {
		event: {
			fetch,
			cookies: mockCookies(),
			url: new URL(`http://localhost/admin/observability/profiler${search}`),
			parent: async () => ({ user: { id: 'u1', roles }, entitlements: { plan: '', state: '', features: [], tenant_quota: 1 } }),
		} as never,
		calls,
	};
}

function actionEvent(fields: Record<string, string>, routes: Record<string, Route>, roles: string[]) {
	const { fetch, calls } = fetchFor(routes, roles);
	const body = new FormData();
	for (const [k, v] of Object.entries(fields)) body.set(k, v);
	return {
		event: { fetch, cookies: mockCookies(), request: new Request('http://localhost/admin/observability/profiler', { method: 'POST', body }) } as never,
		calls,
	};
}

describe('profiler load', () => {
	// The views live under /api/admin/debug/profiler.
	it('reads the four views under /api/admin/debug/profiler for a super admin', async () => {
		const { event, calls } = loadEvent(views, ['super_admin']);
		const result = (await load(event)) as Loaded;
		expect(result.endpoints).toEqual([STATS]);
		expect(result.slowest).toEqual([STATS]);
		expect(result.plugins?.[0].plugin).toBe('core');
		expect(result.memory).toEqual(MEMORY);
		expect(result.selected).toBeNull();
		expect(result.detail).toBeNull();
		const asked = calls.map((c) => c.url).filter((u) => u.includes('/debug/profiler'));
		expect(asked).toHaveLength(4);
		expect(asked.every((u) => u.includes('/api/admin/debug/profiler/'))).toBe(true);
	});

	it('reads the selected endpoint from the URL as the path the engine sampled', async () => {
		const { event, calls } = loadEvent(views, ['super_admin'], '?endpoint=api%2Fv1%2Fcontent');
		const result = (await load(event)) as Loaded;
		expect(result.selected).toBe('/api/v1/content');
		expect(result.detail).toEqual(DETAIL);
		expect(calls.some((c) => c.url.includes('/debug/profiler/endpoint/api/v1/content?limit=100'))).toBe(true);
	});

	it('reports a view the engine did not answer as absent rather than as zeros', async () => {
		const { event } = loadEvent({ ...views, '/debug/profiler/memory': () => json({ error: 'down' }, 503) }, ['super_admin'], '?endpoint=nothing');
		const result = (await load(event)) as Loaded;
		expect(result.memory).toBeNull();
		expect(result.slowest).toEqual([STATS]);
		expect(result.selected).toBe('/nothing');
		expect(result.detail).toBeNull();
	});

	// The ring describes every tenant's traffic and the exports carry process
	// memory, so an admin who is not a super admin is refused before a read.
	it('refuses an admin who is not super admin before any read', async () => {
		const { event, calls } = loadEvent(views, ['admin']);
		await expect(load(event)).rejects.toMatchObject({ status: 403 });
		expect(calls.some((c) => c.url.includes('/debug/profiler'))).toBe(false);
	});
});

describe('the profiler actions', () => {
	it('reset posts to the engine and says so', async () => {
		const { event, calls } = actionEvent({}, { '/debug/profiler/reset': () => json({ status: 'reset' }) }, ['super_admin']);
		expect(await actions.reset(event)).toEqual({ form: 'reset', reset: true });
		const post = calls.find((c) => c.url.includes('/debug/profiler/reset'));
		expect(post?.init?.method).toBe('POST');
	});

	it('captures a flamegraph for the named endpoint over a clamped window', async () => {
		const { event, calls } = actionEvent(
			{ endpoint: '/api/v1/content', duration_sec: '99' },
			{ '/debug/profiler/flamegraph/': (url) => json({ endpoint: '/api/v1/content', duration_sec: Number(new URL(url, 'http://x').searchParams.get('duration_sec')), svg: '<svg/>', profile_type: 'cpu', captured_at: 'now' }) },
			['super_admin'],
		);
		const result = await actions.flamegraph(event);
		expect(result).toMatchObject({ form: 'flamegraph', graph: { svg: '<svg/>', duration_sec: 25 } });
		const post = calls.find((c) => c.url.includes('/debug/profiler/flamegraph/'));
		expect(post?.url).toContain('/api/admin/debug/profiler/flamegraph/api/v1/content?duration_sec=25');
		expect(post?.init?.method).toBe('POST');
	});

	it('refuses a flamegraph with no endpoint before the round trip', async () => {
		const { event, calls } = actionEvent({ endpoint: '', duration_sec: '5' }, {}, ['super_admin']);
		const result = await actions.flamegraph(event);
		expect(result).toMatchObject({ status: 422, data: { form: 'flamegraph' } });
		expect(calls.some((c) => c.init?.method === 'POST')).toBe(false);
	});

	it('refuses an admin who is not super admin before the round trip', async () => {
		const { event, calls } = actionEvent({}, {}, ['admin']);
		await expect(actions.reset(event)).rejects.toMatchObject({ status: 403 });
		expect(calls.some((c) => c.init?.method === 'POST')).toBe(false);
	});
});
