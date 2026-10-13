import { describe, expect, it, vi } from 'vitest';
import type { Cookies } from '@sveltejs/kit';
import { load } from './+page.server';

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const cookies = { get: () => 'tok', set: vi.fn(), delete: vi.fn(), getAll: () => [], serialize: () => '' } as unknown as Cookies;

/** A load event whose fetch answers each path with what `answer` returns. */
function event(answer: (path: string) => Response, search = '') {
	return {
		fetch: vi.fn(async (url: string) => answer(String(url))) as unknown as typeof fetch,
		cookies,
		url: new URL(`http://localhost/admin/api-keys${search}`),
		parent: async () => ({ user: { roles: ['super_admin'] } }),
	} as never;
}

type Loaded = Exclude<Awaited<ReturnType<typeof load>>, void>;

const key = { id: 'k1', name: 'deploy', roles: ['editor'], schemas: [], enabled: true };

describe('API keys load', () => {
	it('keeps a failed key read apart from an empty one', async () => {
		const out = (await load(event(() => json({ error: 'boom' }, 500)))) as Loaded;
		expect(out.keys).toEqual({ ok: false, gate: { state: 'error', message: expect.any(String) } });
	});

	it('sends a page past the end back to the last page that holds keys', async () => {
		const answer = (path: string) =>
			path.startsWith('/api/admin/api-keys') ? json({ data: [], total_count: 60 }) : json({});
		await expect(load(event(answer, '?offset=100&limit=50'))).rejects.toMatchObject({
			status: 307,
			location: '/admin/api-keys?offset=50&limit=50',
		});
	});

	it('marks the usage unknown when its read failed, and absent when the route is missing', async () => {
		const failing = (path: string) => {
			if (path.startsWith('/api/admin/api-keys')) return json({ data: [key], total_count: 1 });
			if (path.startsWith('/api/admin/usage')) return json({ error: 'down' }, 500);
			return json([]);
		};
		const out = (await load(event(failing))) as Loaded;
		expect(out.usageUnknown).toEqual(['k1']);

		const missing = (path: string) => {
			if (path.startsWith('/api/admin/api-keys')) return json({ data: [key], total_count: 1 });
			if (path.startsWith('/api/admin/usage')) return json({ error: 'not found' }, 404);
			return json([]);
		};
		const none = (await load(event(missing))) as Loaded;
		expect(none.usageUnknown).toEqual([]);
	});

	it('says when the schemas or the route catalog could not be read', async () => {
		const answer = (path: string) => {
			if (path.startsWith('/api/admin/api-keys?')) return json({ data: [key], total_count: 1 });
			if (path.startsWith('/api/admin/api-key-scopes')) return json({ error: 'down' }, 503);
			if (path.startsWith('/api/admin/schemas')) return json({ error: 'boom' }, 500);
			return json({});
		};
		const out = (await load(event(answer))) as Loaded;
		expect(out.catalogFailed).toBe(true);
		expect(out.schemasFailed).toBe(true);
	});

	it('says the route catalog could not be read when its answer has no route list', async () => {
		const answer = (path: string) => {
			if (path.startsWith('/api/admin/api-keys?')) return json({ data: [key], total_count: 1 });
			if (path.startsWith('/api/admin/api-key-scopes')) return json({ actions: ['read'] });
			return json([]);
		};
		const out = (await load(event(answer))) as Loaded;
		expect(out.catalog).toBeNull();
		expect(out.catalogFailed).toBe(true);
	});

	it('offers no catalog and says nothing when the engine does not serve one', async () => {
		const answer = (path: string) => {
			if (path.startsWith('/api/admin/api-keys?')) return json({ data: [key], total_count: 1 });
			if (path.startsWith('/api/admin/api-key-scopes')) return json({ error: 'not found' }, 404);
			return json([]);
		};
		const out = (await load(event(answer))) as Loaded;
		expect(out.catalogFailed).toBe(false);
	});
});
