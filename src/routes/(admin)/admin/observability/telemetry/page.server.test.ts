import { describe, expect, it, vi } from 'vitest';
import type { Cookies } from '@sveltejs/kit';
import { actions, load } from './+page.server';

type Loaded = Exclude<Awaited<ReturnType<typeof load>>, void>;

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function text(body: string, status = 200): Response {
	return new Response(body, { status, headers: { 'content-type': 'text/plain; version=0.0.4' } });
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

const TENANT_VIEW = `# HELP lyeve_requests_total Requests served.
# TYPE lyeve_requests_total counter
lyeve_requests_total{code="2xx",method="GET",plugin="core",tenant="acme"} 12
`;

const WHOLE_VIEW = `# TYPE lyeve_db_pool_max_connections gauge
lyeve_db_pool_max_connections 25
${TENANT_VIEW}lyeve_requests_total{code="2xx",method="GET",plugin="core",tenant="globex"} 3
`;

const EXPORTERS = { data: [{ name: 'pushgateway', healthy: true, exports: 2, failures: 0 }], total_count: 1, limit: 50, offset: 0 };

function loadEvent(routes: Record<string, Route>, roles: string[]) {
	const { fetch, calls } = fetchFor(routes, roles);
	return {
		event: {
			fetch,
			cookies: mockCookies(),
			url: new URL('http://localhost/admin/observability/telemetry'),
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
		event: { fetch, cookies: mockCookies(), request: new Request('http://localhost/admin/observability/telemetry', { method: 'POST', body }) } as never,
		calls,
	};
}

describe('telemetry load', () => {
	// The engine narrows the scrape to the caller's tenant. The page asks
	// for the exporters only when the caller may read them, so a tenant
	// admin's load never even sends that request.
	it('reads the metrics only for a tenant admin and never asks for the exporters', async () => {
		const { event, calls } = loadEvent({ '/telemetry/metrics': () => text(TENANT_VIEW) }, ['admin']);
		const result = (await load(event)) as Loaded;
		expect(result.superAdmin).toBe(false);
		expect(result.families?.map((f: { name: string }) => f.name)).toEqual(['lyeve_requests_total']);
		expect(result.families?.[0].samples).toHaveLength(1);
		expect(result.exporters).toBeNull();
		expect(calls.some((c) => c.url.includes('/telemetry/exporters'))).toBe(false);
		const scrape = calls.find((c) => c.url.includes('/telemetry/metrics'));
		expect(scrape?.init?.headers).toMatchObject({ Authorization: 'Bearer tok', Accept: 'text/plain' });
	});

	it('reads the whole registry and the exporters for a super admin', async () => {
		const { event } = loadEvent(
			{ '/telemetry/metrics': () => text(WHOLE_VIEW), '/telemetry/exporters': () => json(EXPORTERS) },
			['super_admin'],
		);
		const result = (await load(event)) as Loaded;
		expect(result.superAdmin).toBe(true);
		expect(result.families?.map((f: { name: string }) => f.name)).toEqual(['lyeve_db_pool_max_connections', 'lyeve_requests_total']);
		expect(result.families?.[1].samples).toHaveLength(2);
		expect(result.exporters).toEqual(EXPORTERS.data);
	});

	it('reports a scrape the plugin refused as absent, not as an empty registry', async () => {
		const { event } = loadEvent({ '/telemetry/metrics': () => json({ error: 'metrics not initialized' }, 503) }, ['admin']);
		const result = (await load(event)) as Loaded;
		expect(result.families).toBeNull();
	});

	it('keeps the metrics when only the exporter list failed', async () => {
		const { event } = loadEvent(
			{ '/telemetry/metrics': () => text(WHOLE_VIEW), '/telemetry/exporters': () => json({ error: 'down' }, 503) },
			['super_admin'],
		);
		const result = (await load(event)) as Loaded;
		expect(result.families).toHaveLength(2);
		expect(result.exporters).toBeNull();
	});

	it('refuses a role below admin', async () => {
		const { event } = loadEvent({}, ['editor']);
		await expect(load(event)).rejects.toMatchObject({ status: 403 });
	});
});

describe('the export action', () => {
	it('posts a manual export for the named exporter as a super admin', async () => {
		const { event, calls } = actionEvent(
			{ name: 'pushgateway' },
			{ '/telemetry/exporters/pushgateway/export': () => json({ status: 'ok', message: 'export triggered for pushgateway' }) },
			['super_admin'],
		);
		const result = await actions.export(event);
		expect(result).toMatchObject({ name: 'pushgateway', exported: true, message: 'export triggered for pushgateway' });
		const post = calls.find((c) => c.url.includes('/exporters/pushgateway/export'));
		expect(post?.init?.method).toBe('POST');
	});

	it('says the cooldown on a 429 rather than a failure', async () => {
		const { event } = actionEvent(
			{ name: 'otlp' },
			{ '/telemetry/exporters/otlp/export': () => json({ error: 'export cooldown active' }, 429) },
			['super_admin'],
		);
		const result = await actions.export(event);
		expect(result).toMatchObject({ status: 429, data: { name: 'otlp' } });
		expect((result as { data: { error: string } }).data.error).toContain('Wait five seconds');
	});

	it('refuses a tenant admin before the round trip', async () => {
		const { event, calls } = actionEvent({ name: 'pushgateway' }, {}, ['admin']);
		await expect(actions.export(event)).rejects.toMatchObject({ status: 403 });
		expect(calls.some((c) => c.init?.method === 'POST')).toBe(false);
	});

	it('refuses an empty name before the round trip', async () => {
		const { event, calls } = actionEvent({ name: ' ' }, {}, ['super_admin']);
		const result = await actions.export(event);
		expect(result).toMatchObject({ status: 400 });
		expect(calls.some((c) => c.init?.method === 'POST')).toBe(false);
	});
});

describe('the tenant destination', () => {
	const STORED = {
		destination: { kind: 'otlp', url: 'https://otlp.example.com/v1/metrics', header_names: ['Authorization'], health: null },
		licensed: true,
	};

	function bodyOf(calls: { url: string; init?: RequestInit }[]) {
		const put = calls.find((c) => c.url.includes('/telemetry/destination') && c.init?.method === 'PUT');
		return put ? JSON.parse(String(put.init?.body)) : null;
	}

	it('reads the destination for a tenant admin', async () => {
		const { event } = loadEvent(
			{ '/telemetry/metrics': () => text(TENANT_VIEW), '/telemetry/destination': () => json(STORED) },
			['admin'],
		);
		const result = (await load(event)) as Loaded;
		expect(result.destination).toEqual(STORED);
	});

	it('reports an unread destination as null rather than as none set', async () => {
		const { event } = loadEvent({ '/telemetry/metrics': () => text(TENANT_VIEW) }, ['admin']);
		const result = (await load(event)) as Loaded;
		expect(result.destination).toBeNull();
	});

	// Header values are write-only: keeping the stored ones means leaving the
	// field out, so the console never has to hold them.
	it('leaves the headers out when the stored ones are kept', async () => {
		const { event, calls } = actionEvent(
			{ kind: 'otlp', url: 'https://otlp.example.com/v2', headers_mode: 'keep' },
			{ '/telemetry/destination': () => json(STORED) },
			['admin'],
		);
		expect(await actions.saveDestination(event)).toEqual({ savedDestination: true });
		expect(bodyOf(calls)).toEqual({ kind: 'otlp', url: 'https://otlp.example.com/v2' });
	});

	it('sends the headers entered when they are replaced', async () => {
		const body = new FormData();
		for (const [k, v] of [
			['kind', 'pushgateway'],
			['url', 'https://push.example.com'],
			['headers_mode', 'replace'],
			['header_name', 'Authorization'],
			['header_value', 'Bearer abc'],
			['header_name', ''],
			['header_value', 'ignored'],
		]) body.append(k, v);
		const { fetch, calls } = fetchFor({ '/telemetry/destination': () => json(STORED) }, ['admin']);
		const event = {
			fetch,
			cookies: mockCookies(),
			request: new Request('http://localhost/admin/observability/telemetry', { method: 'POST', body }),
		} as never;
		await actions.saveDestination(event);
		expect(bodyOf(calls)).toEqual({
			kind: 'pushgateway',
			url: 'https://push.example.com',
			headers: { Authorization: 'Bearer abc' },
		});
	});

	it('refuses a header the exporter sets itself', async () => {
		const { event, calls } = actionEvent(
			{ kind: 'otlp', url: 'https://x.example.com', headers_mode: 'replace', header_name: 'Content-Type', header_value: 'x' },
			{},
			['admin'],
		);
		const result = (await actions.saveDestination(event)) as { status: number };
		expect(result.status).toBe(400);
		expect(bodyOf(calls)).toBeNull();
	});

	it('marks the refusal to carry stored headers to another host', async () => {
		const { event } = actionEvent(
			{ kind: 'otlp', url: 'https://elsewhere.example.net', headers_mode: 'keep' },
			{
				'/telemetry/destination': () =>
					json({ error: 'the destination moved to another host, send its headers again', code: 'telemetry.headers_required' }, 422),
			},
			['admin'],
		);
		const result = (await actions.saveDestination(event)) as { status: number; data: { hostMoved: boolean } };
		expect(result.status).toBe(422);
		expect(result.data.hostMoved).toBe(true);
	});

	it('relays any other 422 without asking for the headers', async () => {
		const { event } = actionEvent(
			{ kind: 'otlp', url: 'https://elsewhere.example.net', headers_mode: 'keep' },
			{ '/telemetry/destination': () => json({ error: 'the target is on another host the guard refuses' }, 422) },
			['admin'],
		);
		const result = (await actions.saveDestination(event)) as {
			status: number;
			data: { hostMoved?: boolean; destinationError: string };
		};
		expect(result.data.hostMoved).toBeUndefined();
		expect(result.data.destinationError).toBe('the target is on another host the guard refuses');
	});

	it('returns the license refusal under its own keys', async () => {
		const { event } = actionEvent(
			{ kind: 'otlp', url: 'https://x.example.com', headers_mode: 'replace' },
			{
				'/telemetry/destination': () =>
					json({ error: 'payment_required', plugin: 'example', feature: 'feature:example_feature' }, 402),
			},
			['admin'],
		);
		const result = (await actions.saveDestination(event)) as {
			status: number;
			data: { refused: { kind: string }; error?: string };
		};
		expect(result.status).toBe(402);
		expect(result.data.refused.kind).toBe('feature');
		expect(result.data.error).toBeUndefined();
	});
});
