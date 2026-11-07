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

describe('where forms can send', () => {
	const FULL = { state: 'named', running: ['builder', 'flow', 'schema'], withheld: [] };
	const trigger = { type: 'trigger.event', config: { kind: 'system', name: 'builder.form.submitted' } };
	const FORMS_ROUTES: Routes = {
		...LISTED,
		'GET /api/admin/schemas': json([
			{ name: 'contact_messages', display_name: 'Contact messages' },
			{ name: 'form_submissions', display_name: 'Form submissions' },
			{ name: 'posts', display_name: 'Posts', public_delivery: true },
			{ name: 'lyeve_builder_pages', display_name: 'Pages' },
		]),
		'GET /api/admin/flows': json({
			data: [
				{ id: 'f1', slug: 'notify', name: 'Notify', status: 'active', version: 1, trigger_type: 'trigger.event' },
				{ id: 'f2', slug: 'hook', name: 'Hook', status: 'active', version: 1, trigger_type: 'trigger.http' },
			],
			total: 2,
		}),
		'GET /api/admin/flows/f1/versions/1': json({ definition: { trigger } }),
		'GET /api/admin/schemas/presets': json({ presets: [{ id: 'forms', name: 'Forms', description: '', schemas: [] }] }),
	};

	it('offers the types forms can save into, the preset type first, with the flows and the preset', async () => {
		const { event } = loadEvent(FORMS_ROUTES, { plugins: FULL });
		const out = (await load(event)) as Record<string, unknown>;
		// A type the delivery API serves and the builder's own types are never offered.
		expect(out.formSchemas).toEqual([
			{ name: 'form_submissions', label: 'Form submissions' },
			{ name: 'contact_messages', label: 'Contact messages' },
		]);
		expect(out.flows).toEqual({
			ok: true,
			value: [
				{ id: 'f1', slug: 'notify', name: 'Notify', status: 'active', formTrigger: true },
				{ id: 'f2', slug: 'hook', name: 'Hook', status: 'active', formTrigger: false },
			],
		});
		expect(out.formsPreset).toBe(true);
	});

	it.each([
		[
			{ field: 'forms', form_schemas_offered: '1', form_schemas: ['form_submissions'], form_flows_offered: '1', form_flows: ['notify'] },
			{ form_schemas: ['form_submissions'], form_flows: ['notify'] },
		],
		// A flow list that failed to load leaves the flows as they are.
		[{ field: 'forms', form_schemas_offered: '1' }, { form_schemas: [] }],
	])('saves only the lists the form offered', async (fields, body) => {
		const { event, calls } = act(fields, { [`PUT ${BASE}/settings`]: json(SETTINGS) });
		expect(await actions.setting(event)).toMatchObject({ saved: { field: 'forms' } });
		expect(calls).toEqual([{ method: 'PUT', path: `${BASE}/settings`, body }]);
	});

	it('lands a refused flow slug on the flow list', async () => {
		const { event } = act(
			{ field: 'forms', form_flows_offered: '1', form_flows: ['Bad'] },
			{ [`PUT ${BASE}/settings`]: refusal(422, 'settings_invalid', 'Choose a flow slug.', { field: 'form_flows' }) },
		);
		expect(((await actions.setting(event)) as Failure).data.settingError).toEqual({ field: 'form_flows', message: 'Choose a flow slug.' });
	});

	it('applies the forms preset and allows its submissions type', async () => {
		const { event, calls } = act(
			{},
			{
				'GET /api/admin/schemas': json([{ name: 'posts' }]),
				[`GET ${BASE}/settings`]: json({ ...SETTINGS, form_schemas: ['contact_messages'] }),
				'POST /api/admin/schemas/presets/forms': json({ created: ['forms', 'form_submissions'] }),
				[`PUT ${BASE}/settings`]: json({ ...SETTINGS, form_schemas: ['contact_messages', 'form_submissions'] }),
			},
		);
		expect(await actions.formsPreset(event)).toMatchObject({ presetApplied: { created: true } });
		expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ form_schemas: ['contact_messages', 'form_submissions'] });
	});

	it('only allows the submissions type when it exists already', async () => {
		const { event, calls } = act(
			{},
			{
				'GET /api/admin/schemas': json([{ name: 'form_submissions' }]),
				[`GET ${BASE}/settings`]: json({ ...SETTINGS, form_schemas: [] }),
				[`PUT ${BASE}/settings`]: json({ ...SETTINGS, form_schemas: ['form_submissions'] }),
			},
		);
		expect(await actions.formsPreset(event)).toMatchObject({ presetApplied: { created: false } });
		expect(calls.some((c) => c.method === 'POST')).toBe(false);
		expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ form_schemas: ['form_submissions'] });
	});

	it('says the preset is missing on a 404 and saves nothing', async () => {
		const { event, calls } = act({}, { 'GET /api/admin/schemas': json([]), [`GET ${BASE}/settings`]: json({ ...SETTINGS, form_schemas: [] }) });
		expect(await actions.formsPreset(event)).toMatchObject({ status: 404, data: { presetMissing: true } });
		expect(calls.some((c) => c.method === 'PUT')).toBe(false);
	});
});
