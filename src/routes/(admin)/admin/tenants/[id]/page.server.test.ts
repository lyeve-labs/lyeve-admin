import { describe, it, expect, vi } from 'vitest';
import type { Cookies } from '@sveltejs/kit';

import { actions, load } from './+page.server';

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
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

const TENANT = {
	id: 't1',
	slug: 'acme',
	name: 'Acme',
	plan: 'example',
	enabled: true,
	archived: false,
	created_at: '2026-01-01T00:00:00Z',
	updated_at: '2026-01-01T00:00:00Z',
};

type Call = { url: string; method: string; body: unknown };

/** An event whose fetch answers by route and records every call. */
function event(routes: Record<string, unknown>, form?: FormData) {
	const calls: Call[] = [];
	const fetch = vi.fn(async (url: string, init?: RequestInit) => {
		const method = init?.method ?? 'GET';
		const path = new URL(String(url), 'http://localhost').pathname;
		calls.push({ url: path, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
		const hit = routes[`${method} ${path}`];
		if (hit === undefined) return json({ error: 'not found' }, 404);
		if (hit instanceof Response) return hit;
		return json(hit);
	}) as unknown as typeof globalThis.fetch;
	return {
		calls,
		event: {
			fetch,
			cookies: mockCookies(),
			params: { id: 't1' },
			url: new URL('http://localhost/admin/tenants/t1'),
			request: form ? new Request('http://localhost', { method: 'POST', body: form }) : undefined,
			parent: async () => ({ user: { roles: ['super_admin'] }, entitlements: { features: ['search', 'flow'] } }),
		} as never,
	};
}

const ME = { id: 'u0', email: 'root@example.com', roles: ['super_admin'] };

describe('admin/tenants/[id] load', () => {
	it('offers what the instance serves and marks what is withheld', async () => {
		const { event: ev } = event({
			'GET /api/admin/tenants/t1': TENANT,
			'GET /api/admin/tenant-features/acme': { tenant: 'acme', withheld: ['search'], known: ['ai', 'flow', 'search'] },
			'GET /api/admin/tenant-members/acme': { members: [{ id: 'u1', email: 'a@x.io', disabled: false, home: true, roles: ['admin'] }], total: 1 },
		});
		const data = (await load(ev)) as Exclude<Awaited<ReturnType<typeof load>>, void>;
		expect(data.choices).toEqual([
			{ name: 'flow', available: true },
			{ name: 'search', available: false },
		]);
		expect(data.members?.[0].email).toBe('a@x.io');
	});

	it('keeps the features when the members read fails', async () => {
		const { event: ev } = event({
			'GET /api/admin/tenants/t1': TENANT,
			'GET /api/admin/tenant-features/acme': { tenant: 'acme', withheld: [], known: ['flow'] },
		});
		const data = (await load(ev)) as Exclude<Awaited<ReturnType<typeof load>>, void>;
		expect(data.members).toBeNull();
		expect(data.choices).toEqual([{ name: 'flow', available: true }]);
	});
});

describe('admin/tenants/[id] features action', () => {
	it('withholds every offered name left unticked', async () => {
		const form = new FormData();
		for (const n of ['flow', 'search', 'ai']) form.append('offered', n);
		form.append('available', 'flow');
		const { event: ev, calls } = event(
			{
				'GET /api/admin/auth/me': ME,
				'GET /api/admin/tenants/t1': TENANT,
				'PUT /api/admin/tenant-features/acme': { tenant: 'acme', withheld: ['ai', 'search'], known: [] },
			},
			form,
		);
		const result = await actions.features(ev);
		expect(result).toEqual({ featuresSaved: 2 });
		const put = calls.find((c) => c.method === 'PUT');
		expect(put?.body).toEqual({ withheld: ['ai', 'search'] });
	});
});

describe('admin/tenants/[id] grant action', () => {
	function grantForm(roles: string): FormData {
		const form = new FormData();
		form.append('user_id', 'u1');
		form.append('roles', roles);
		return form;
	}

	function refused(body: Record<string, unknown>) {
		return event(
			{
				'GET /api/admin/auth/me': ME,
				'GET /api/admin/tenants/t1': TENANT,
				'PUT /api/admin/users/u1/memberships': json(body, 402),
			},
			grantForm('admin'),
		).event;
	}

	it('says every seat is taken when the grant is refused at the seat ceiling', async () => {
		const result = await actions.grant(
			refused({ error: 'cap_exceeded', cap: 'admin.seats', limit: 7, current: 7, upgrade_url: '' }),
		);
		expect(result).toEqual({
			status: 402,
			data: {
				memberError:
					'Every admin seat is taken. 7 of 7 are in use, which is the most this instance allows. Editors and viewers take no seat, so remove the admin role from an account to add another.',
			},
		});
	});

	it('leaves a refusal at another cap to the usual message', async () => {
		const result = (await actions.grant(
			refused({ error: 'cap_exceeded', cap: 'example.items', limit: 4, current: 4 }),
		)) as { status: number; data: { memberError: string } };
		expect(result.status).toBe(400);
		expect(result.data.memberError).not.toContain('admin seat');
	});

	it('saves a grant the engine accepts', async () => {
		const { event: ev, calls } = event(
			{
				'GET /api/admin/auth/me': ME,
				'GET /api/admin/tenants/t1': TENANT,
				'PUT /api/admin/users/u1/memberships': { tenant_id: 'acme', roles: ['editor'] },
			},
			grantForm('editor'),
		);
		expect(await actions.grant(ev)).toEqual({ memberSaved: true });
		expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ tenant_id: 'acme', roles: ['editor'] });
	});
});
