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

type Loaded = Exclude<Awaited<ReturnType<typeof load>>, void>;

/** A load event whose list and schema reads answer with the given statuses. */
function loadEvent(list: number, schemas = 200) {
	const fetch = vi.fn(async (url: string) => {
		const asked = String(url);
		if (asked.includes('/schemas')) return schemas === 200 ? json([]) : json({ error: 'nope' }, schemas);
		return list === 200 ? json({ data: [] }) : json({ error: 'nope' }, list);
	}) as unknown as typeof globalThis.fetch;
	return {
		fetch,
		cookies: mockCookies(),
		url: new URL('http://localhost/admin/webhooks/incoming'),
	} as never;
}

/*
 * An empty list is the first-run state with an offer to create the first
 * endpoint. A read that failed is a gate, never that state.
 */
describe('admin/webhooks/incoming load', () => {
	it('keeps a failed list read as its gate, never as no endpoints', async () => {
		expect(((await load(loadEvent(500))) as Loaded).incomingWebhooks).toMatchObject({ ok: false, gate: { state: 'error' } });
		expect(((await load(loadEvent(503))) as Loaded).incomingWebhooks).toEqual({ ok: false, gate: { state: 'unavailable' } });
		expect(((await load(loadEvent(403))) as Loaded).incomingWebhooks).toEqual({ ok: false, gate: { state: 'forbidden' } });
	});

	it('keeps a failed schema read apart from a list of none', async () => {
		const result = (await load(loadEvent(200, 503))) as Loaded;
		expect(result.incomingWebhooks).toEqual({ ok: true, value: [] });
		expect(result.schemas).toEqual({ ok: false, gate: { state: 'unavailable' } });
	});
});

/*
 * The plugin serves create, update and delete to a super admin only, so an
 * admin's direct POST stops here before it reaches the engine.
 */
describe('admin/webhooks/incoming writes by role', () => {
	function writeEvent(roles: string[]) {
		const seen: string[] = [];
		const fetch = vi.fn(async (url: string) => {
			seen.push(String(url));
			if (String(url).includes('/auth/me')) return json({ id: 'u1', roles, disabled: false });
			return json({});
		}) as unknown as typeof globalThis.fetch;
		const form = new FormData();
		form.set('id', 'i1');
		form.set('field_map', '{"id":"external_id"}');
		return {
			seen,
			event: {
				fetch,
				cookies: mockCookies(),
				request: { formData: async () => form },
				url: new URL('http://localhost/admin/webhooks/incoming'),
			} as never,
		};
	}

	it.each(['create', 'update', 'delete'] as const)('refuses %s to an admin', async (name) => {
		const { event, seen } = writeEvent(['admin']);
		await expect(actions[name](event)).rejects.toMatchObject({ status: 403 });
		expect(seen.filter((u) => !u.includes('/auth/me'))).toEqual([]);
	});

	it('lets a super admin delete', async () => {
		const { event, seen } = writeEvent(['super_admin']);
		await actions.delete(event);
		expect(seen.some((u) => u.includes('/api/admin/incoming-webhooks/i1'))).toBe(true);
	});
});
