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

/** The license the instance holds, read by the page itself. */
const LICENSE = { plan: 'example', state: 'active', features: ['search', 'flow'], tenant_quota: 0 };

type Call = { url: string; query: string; method: string; body: unknown };

/** An event whose fetch answers by route and records every call. */
function event(routes: Record<string, unknown>, form?: FormData) {
	const calls: Call[] = [];
	const fetch = vi.fn(async (url: string, init?: RequestInit) => {
		const method = init?.method ?? 'GET';
		const asked = new URL(String(url), 'http://localhost');
		const path = asked.pathname;
		calls.push({ url: path, query: asked.search, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
		const answers: Record<string, unknown> = { 'GET /api/admin/entitlements': LICENSE, ...routes };
		const hit = answers[`${method} ${path}`];
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
			// The shell's entitlements are its failed read, so nothing here may
			// take the license from them.
			parent: async () => ({ user: { roles: ['super_admin'] }, entitlements: { plan: '', state: '', features: [], tenant_quota: 0 } }),
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
		expect(data.choices).toEqual({
			ok: true,
			value: [
				{ name: 'flow', available: true },
				{ name: 'search', available: false },
			],
		});
		expect(data.members.ok && data.members.value[0].email).toBe('a@x.io');
	});

	it('keeps the features when the members read fails', async () => {
		const { event: ev } = event({
			'GET /api/admin/tenants/t1': TENANT,
			'GET /api/admin/tenant-features/acme': { tenant: 'acme', withheld: [], known: ['flow'] },
		});
		const data = (await load(ev)) as Exclude<Awaited<ReturnType<typeof load>>, void>;
		expect(data.members).toMatchObject({ ok: false, gate: { state: 'absent' } });
		expect(data.choices).toEqual({ ok: true, value: [{ name: 'flow', available: true }] });
	});

	// A tenant that exists is never reported missing because the engine or its
	// database did not answer.
	it('answers 404 only for the engine 404', async () => {
		const missing = event({});
		await expect(load(missing.event)).rejects.toMatchObject({ status: 404, body: { message: 'No tenant has that id.' } });

		const down = event({ 'GET /api/admin/tenants/t1': json({ error: 'database unavailable' }, 503) });
		await expect(load(down.event)).rejects.toMatchObject({ status: 503 });

		const refused = event({ 'GET /api/admin/tenants/t1': json({ error: 'forbidden' }, 403) });
		await expect(load(refused.event)).rejects.toMatchObject({ status: 403 });
	});

	it('keeps a license that could not be read as its gate, never as nothing to offer', async () => {
		const { event: ev } = event({
			'GET /api/admin/tenants/t1': TENANT,
			'GET /api/admin/entitlements': json({ error: 'database unavailable' }, 503),
			'GET /api/admin/tenant-features/acme': { tenant: 'acme', withheld: [], known: ['flow'] },
			'GET /api/admin/tenant-members/acme': { members: [], total: 0 },
		});
		const data = (await load(ev)) as Exclude<Awaited<ReturnType<typeof load>>, void>;
		expect(data.choices).toEqual({ ok: false, gate: { state: 'unavailable' } });
	});

	it('keeps an outage on the members read apart from a tenant with no members', async () => {
		const { event: ev } = event({
			'GET /api/admin/tenants/t1': TENANT,
			'GET /api/admin/tenant-features/acme': { tenant: 'acme', withheld: [], known: ['flow'] },
			'GET /api/admin/tenant-members/acme': json({ error: 'database unavailable' }, 503),
		});
		const data = (await load(ev)) as Exclude<Awaited<ReturnType<typeof load>>, void>;
		expect(data.members).toEqual({ ok: false, gate: { state: 'unavailable' } });
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
				action: 'grant',
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

describe('admin/tenants/[id] members paging', () => {
	it('asks for the window the address names', async () => {
		const { event: ev, calls } = event({
			'GET /api/admin/tenants/t1': TENANT,
			'GET /api/admin/tenant-features/acme': { tenant: 'acme', withheld: [], known: [] },
			'GET /api/admin/tenant-members/acme': { members: [{ id: 'u1', email: 'a@x.io', disabled: false, home: true, roles: ['admin'] }], total: 51 },
		});
		(ev as { url: URL }).url = new URL('http://localhost/admin/tenants/t1?limit=50&offset=50');
		const data = (await load(ev)) as Exclude<Awaited<ReturnType<typeof load>>, void>;
		expect(data.offset).toBe(50);
		const members = calls.find((c) => c.url === '/api/admin/tenant-members/acme');
		expect(new URLSearchParams(members?.query).get('limit')).toBe('50');
		expect(new URLSearchParams(members?.query).get('offset')).toBe('50');
	});

	it('sends a page past the end back to the last page that holds rows', async () => {
		const { event: ev } = event({
			'GET /api/admin/tenants/t1': TENANT,
			'GET /api/admin/tenant-features/acme': { tenant: 'acme', withheld: [], known: [] },
			'GET /api/admin/tenant-members/acme': { members: [], total: 3 },
		});
		(ev as { url: URL }).url = new URL('http://localhost/admin/tenants/t1?limit=50&offset=100');
		await expect(load(ev)).rejects.toMatchObject({ status: 307, location: '/admin/tenants/t1?limit=50&offset=0' });
	});
});
