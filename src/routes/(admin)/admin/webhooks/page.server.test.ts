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

function hooks(count: number, from = 0) {
	return Array.from({ length: count }, (_, i) => ({
		id: `w${from + i}`,
		name: `hook-${from + i}`,
		url: 'https://example.test/hook',
		events: ['content.created'],
		schemas: [],
		enabled: true,
		created_at: '2026-01-01T00:00:00Z',
		updated_at: '2026-01-01T00:00:00Z',
	}));
}

/**
 * The load reads the webhooks and the schemas in parallel. The schema request
 * is answered with an empty array so each case is about the list under test.
 */
function loadEvent(body: unknown, search = '') {
	const seen: string[] = [];
	const fetch = vi.fn(async (url: string) => {
		const asked = String(url);
		seen.push(asked);
		if (asked.includes('/schemas')) return json([]);
		return json(body);
	}) as unknown as typeof globalThis.fetch;

	return {
		seen,
		event: {
			fetch,
			cookies: mockCookies(),
			url: new URL(`http://localhost/admin/webhooks${search}`),
			parent: async () => ({ user: { roles: ['super_admin'] } }),
		} as never,
	};
}

type Loaded = Exclude<Awaited<ReturnType<typeof load>>, void>;

const webhookCall = (seen: string[]) => seen.find((u) => u.includes('/webhooks')) ?? '';

/*
 * The request always carries a limit and an offset. The read goes straight to
 * the client rather than through listWebhooks, which unwraps the rows and
 * drops the envelope the row count sits in.
 */
describe('admin/webhooks/+page.server.ts load', () => {
	it('asks the endpoint for a bounded window', async () => {
		const { seen, event } = loadEvent(hooks(5));

		await load(event);

		expect(webhookCall(seen)).toContain('limit=');
		expect(webhookCall(seen)).toContain('offset=0');
	});

	it('carries the window the request named', async () => {
		const { seen, event } = loadEvent(hooks(5), '?limit=10&offset=30');

		const result = (await load(event)) as Loaded;

		expect(webhookCall(seen)).toContain('offset=30');
		expect(result.limit).toBe(10);
		expect(result.offset).toBe(30);
	});

	it('keeps the probe row out of the table', async () => {
		const { event } = loadEvent(hooks(51), '?limit=50');

		const result = (await load(event)) as Loaded;

		expect(result.webhooks.ok && result.webhooks.value).toHaveLength(50);
		expect(result.hasMore).toBe(true);
	});

	it('states the count the envelope carried rather than probing', async () => {
		const { event } = loadEvent({ data: hooks(50), total_count: 812 }, '?limit=50');

		const result = (await load(event)) as Loaded;

		expect(result.total).toBe(812);
		expect(result.hasMore).toBe(true);
	});

	it('states no total when the endpoint sent a bare array', async () => {
		const { event } = loadEvent(hooks(5));

		const result = (await load(event)) as Loaded;

		expect(result.total).toBeNull();
	});

	it('bounds a response that ignored the window', async () => {
		const { event } = loadEvent(hooks(10_000), '?limit=50');

		const result = (await load(event)) as Loaded;

		expect(result.webhooks.ok && result.webhooks.value).toHaveLength(50);
	});

	function failing(status: number, schemas = 200, search = '?offset=50') {
		const fetch = vi.fn(async (url: string) =>
			String(url).includes('/schemas')
				? schemas === 200
					? json([])
					: json({ error: 'nope' }, schemas)
				: json({ error: 'nope' }, status)
		) as unknown as typeof globalThis.fetch;
		return {
			fetch,
			cookies: mockCookies(),
			url: new URL(`http://localhost/admin/webhooks${search}`),
			parent: async () => ({ user: { roles: ['super_admin'] } }),
		} as never;
	}

	// An empty list is the first-run state with an offer to create the first
	// webhook. A read that failed is a gate, never that state, and it is not
	// sent back to page one as if the list had ended.
	it('keeps a failed list read as its gate, never as no webhooks', async () => {
		const failed = (await load(failing(500))) as Loaded;
		expect(failed.webhooks).toMatchObject({ ok: false, gate: { state: 'error' } });
		expect(failed.hasMore).toBe(false);
		expect(((await load(failing(503))) as Loaded).webhooks).toEqual({ ok: false, gate: { state: 'unavailable' } });
		expect(((await load(failing(403))) as Loaded).webhooks).toEqual({ ok: false, gate: { state: 'forbidden' } });
	});

	it('keeps a failed schema read apart from a list of none', async () => {
		const result = (await load(failing(200, 503, ''))) as Loaded;
		expect(result.schemas).toEqual({ ok: false, gate: { state: 'unavailable' } });
	});
});

/*
 * The engine answers the dead letter list with its standard envelope, data
 * and total_count. The action reads the envelope as it is sent and hands the
 * page rows, because a reader expecting items and total sees an empty queue
 * while deliveries wait in it.
 */
describe('admin/webhooks/+page.server.ts dead-letters action', () => {
	function actionEvent(body: unknown, status = '') {
		const seen: string[] = [];
		const fetch = vi.fn(async (url: string) => {
			const asked = String(url);
			seen.push(asked);
			if (asked.includes('/auth/me')) return json({ id: 'u1', roles: ['admin'], disabled: false });
			return json(body);
		}) as unknown as typeof globalThis.fetch;
		const form = new FormData();
		if (status) form.set('status', status);
		return {
			seen,
			event: {
				fetch,
				cookies: mockCookies(),
				request: { formData: async () => form },
				url: new URL('http://localhost/admin/webhooks'),
			} as never,
		};
	}

	it('reads the rows out of the data envelope and states the total', async () => {
		const { seen, event } = actionEvent({
			data: [{ id: 'd1', webhook_name: 'inventory' }, { id: 'd2', webhook_name: 'inventory' }],
			total_count: 188,
			limit: 50,
			offset: 0,
		});

		const result = (await actions['dead-letters'](event)) as {
			deadLetters: { id: string }[];
			deadLetterTotal: number | null;
		};

		expect(result.deadLetters.map((d) => d.id)).toEqual(['d1', 'd2']);
		expect(result.deadLetterTotal).toBe(188);
		expect(seen.find((u) => u.includes('/webhook-dead-letters'))).toContain('limit=50');
	});

	it('passes the status filter through and sends none when the form named none', async () => {
		const filtered = actionEvent({ data: [], total_count: 0 }, 'pending');
		await actions['dead-letters'](filtered.event);
		expect(filtered.seen.find((u) => u.includes('/webhook-dead-letters'))).toContain('status=pending');

		const all = actionEvent({ data: [], total_count: 0 });
		await actions['dead-letters'](all.event);
		expect(all.seen.find((u) => u.includes('/webhook-dead-letters'))).not.toContain('status=');
	});
});

/*
 * The plugin serves create, update, delete and rotate to a super admin only, so
 * an admin's direct POST stops here before it reaches the engine.
 */
describe('admin/webhooks/+page.server.ts writes by role', () => {
	function writeEvent(roles: string[]) {
		const seen: string[] = [];
		const fetch = vi.fn(async (url: string) => {
			seen.push(String(url));
			if (String(url).includes('/auth/me')) return json({ id: 'u1', roles, disabled: false });
			return json({});
		}) as unknown as typeof globalThis.fetch;
		const form = new FormData();
		form.set('id', 'w1');
		return {
			seen,
			event: {
				fetch,
				cookies: mockCookies(),
				request: { formData: async () => form },
				url: new URL('http://localhost/admin/webhooks'),
			} as never,
		};
	}

	it.each(['create', 'update', 'delete', 'rotate-secret'] as const)('refuses %s to an admin', async (name) => {
		const { event, seen } = writeEvent(['admin']);
		await expect(actions[name](event)).rejects.toMatchObject({ status: 403 });
		expect(seen.filter((u) => !u.includes('/auth/me'))).toEqual([]);
	});

	it('lets a super admin delete', async () => {
		const { event, seen } = writeEvent(['super_admin']);
		await actions.delete(event);
		expect(seen.some((u) => u.includes('/api/admin/webhooks/w1'))).toBe(true);
	});
});
