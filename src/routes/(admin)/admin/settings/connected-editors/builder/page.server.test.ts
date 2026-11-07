import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/authz', async () => {
	const { createClient } = await vi.importActual<typeof import('@lyeve-labs/client')>('@lyeve-labs/client');
	return { authedClient: (event: { fetch: typeof fetch }) => createClient(event.fetch) };
});

import { actions, load } from './+page.server';

const BASE = '/api/admin/builder';
const RUNNING = { state: 'named', running: ['builder'], withheld: [] };

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

function refusal(status: number, code: string, error = 'The engine said no.', extra: Record<string, unknown> = {}) {
	return json({ error, code, ...extra }, status);
}

type Call = { method: string; path: string; body: unknown };
type Routes = Record<string, Response | (() => Response)>;

/** A fake engine that answers each `METHOD /path` it knows and records every request. */
function engine(routes: Routes) {
	const calls: Call[] = [];
	const fetch = vi.fn(async (url: string, init?: RequestInit) => {
		const method = init?.method ?? 'GET';
		const path = String(url);
		calls.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
		const key = `${method} ${path.split('?')[0]}`;
		const hit = routes[key];
		if (!hit) return json({ error: 'not found' }, 404);
		return (typeof hit === 'function' ? hit() : hit).clone();
	});
	return { calls, fetch };
}

const SETTINGS = { allowed: true, lifetime_days: 90, show_schemas: ['posts'], writes_per_minute: 120, max_writes_per_minute: 120 };

function loadEvent(routes: Routes, { roles = ['admin'], plugins = RUNNING as unknown } = {}) {
	const e = engine(routes);
	const url = new URL('http://admin/admin/settings/connected-editors/builder');
	return {
		...e,
		event: {
			fetch: e.fetch,
			url,
			request: new Request(url),
			parent: async () => ({ plugins, user: { id: 'u1', email: 'maria@example.com', roles, tenant_id: 't1' } }),
		} as never,
	};
}

const LISTED: Routes = {
	[`GET ${BASE}/settings`]: json(SETTINGS),
	'GET /api/admin/schemas': json([{ name: 'posts' }, { name: 'lyeve_builder_pages' }, { name: 'products' }]),
};

describe('builder settings load', () => {
	it('reads the settings and the schemas for an owner, and nothing of the list', async () => {
		const { event, calls } = loadEvent(LISTED);
		const out = (await load(event)) as Record<string, unknown>;
		expect(out.gate).toEqual({ state: 'ok' });
		expect(out.settings).toEqual({ ok: true, value: SETTINGS });
		expect(out.schemas).toEqual(['posts', 'products']);
		expect(out.schemasGate).toBeNull();
		expect(calls.some((c) => c.path.startsWith(`${BASE}/connections`))).toBe(false);
	});

	it.each([['editor'], ['viewer']])('refuses a person below owner without asking the engine (%s)', async (role) => {
		const { event, calls } = loadEvent(LISTED, { roles: [role] });
		await expect(load(event)).rejects.toMatchObject({
			status: 403,
			body: { message: 'Only an admin or a super admin can open this page.' },
		});
		expect(calls).toEqual([]);
	});

	it('makes no engine call while the plugin does not run', async () => {
		const { event, calls } = loadEvent(LISTED, { plugins: { state: 'named', running: [], withheld: [] } });
		const out = (await load(event)) as { gate: unknown; settings: unknown };
		expect(out.gate).toEqual({ state: 'absent' });
		expect(out.settings).toBeNull();
		expect(calls).toEqual([]);
	});

	it('says the schema list failed rather than reading it as empty', async () => {
		const { event } = loadEvent({ ...LISTED, 'GET /api/admin/schemas': refusal(503, 'store_unavailable') });
		const out = (await load(event)) as { schemas: unknown; schemasGate: unknown };
		expect(out.schemas).toEqual([]);
		expect(out.schemasGate).toEqual({ state: 'unavailable' });
	});

	it('keeps a refused settings read as a failure of the settings', async () => {
		const { event } = loadEvent({ ...LISTED, [`GET ${BASE}/settings`]: refusal(503, 'store_unavailable') });
		const out = (await load(event)) as { settings: unknown; gate: unknown };
		expect(out.gate).toEqual({ state: 'ok' });
		expect(out.settings).toEqual({ ok: false, gate: { state: 'unavailable' } });
	});

	it('draws a tenant the plugin is withheld from as the page gate', async () => {
		const { event } = loadEvent({ ...LISTED, [`GET ${BASE}/settings`]: refusal(403, 'TENANT_FEATURE_WITHHELD') });
		const out = (await load(event)) as { settings: unknown; gate: unknown };
		expect(out.gate).toEqual({ state: 'withheld' });
		expect(out.settings).toBeNull();
	});
});

type Failure = { status: number; data: Record<string, unknown> };

function act(fields: Record<string, string | string[]>, routes: Routes) {
	const e = engine(routes);
	const body = new FormData();
	for (const [k, v] of Object.entries(fields)) {
		for (const one of Array.isArray(v) ? v : [v]) body.append(k, one);
	}
	const url = new URL('http://admin/admin/settings/connected-editors/builder');
	return { ...e, event: { fetch: e.fetch, url, request: new Request(url, { method: 'POST', body }) } as never };
}

describe('setting', () => {
	afterEach(() => vi.restoreAllMocks());

	it.each([
		[{ field: 'allowed', allowed: 'off' }, { allowed: false }],
		[
			{ field: 'limits', lifetime_days: '30', writes_per_minute: '60', schemas_offered: '1', show_schemas: ['posts', 'products'] },
			{ lifetime_days: 30, writes_per_minute: 60, show_schemas: ['posts', 'products'] },
		],
		[
			{ field: 'limits', lifetime_days: '90', writes_per_minute: '120', schemas_offered: '1' },
			{ lifetime_days: 90, writes_per_minute: 120, show_schemas: [] },
		],
		// A form whose schema list failed to load leaves the schemas as they are.
		[{ field: 'limits', lifetime_days: '180', writes_per_minute: '10' }, { lifetime_days: 180, writes_per_minute: 10 }],
	])('saves the switch alone and the other settings together', async (fields, body) => {
		const { event, calls } = act(fields, { [`PUT ${BASE}/settings`]: json(SETTINGS) });
		expect(await actions.setting(event)).toMatchObject({ saved: { field: fields.field } });
		expect(calls).toEqual([{ method: 'PUT', path: `${BASE}/settings`, body }]);
	});

	it('lands a refused value on the field the engine names', async () => {
		const { event } = act(
			{ field: 'limits', lifetime_days: '90', writes_per_minute: '100000' },
			{ [`PUT ${BASE}/settings`]: json({ error: 'Writes must be between 1 and 120 a minute.', code: 'settings_invalid', field: 'writes_per_minute' }, 422) },
		);
		expect(((await actions.setting(event)) as Failure).data.settingError).toEqual({
			field: 'writes_per_minute',
			message: 'Writes must be between 1 and 120 a minute.',
		});
	});

	it('refuses a lifetime the engine does not offer without asking it', async () => {
		const { event, calls } = act({ field: 'limits', lifetime_days: '45', writes_per_minute: '60' }, {});
		expect(((await actions.setting(event)) as Failure).data.settingError).toEqual({
			field: 'lifetime_days',
			message: 'Choose 30, 90 or 180 days.',
		});
		expect(calls).toEqual([]);
	});
});
