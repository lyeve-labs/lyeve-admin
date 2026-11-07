import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/authz', async () => {
	const { createClient } = await vi.importActual<typeof import('@lyeve-labs/client')>('@lyeve-labs/client');
	return { authedClient: (event: { fetch: typeof fetch }) => createClient(event.fetch) };
});

import { actions, load } from './+page.server';

const RUNNING = { state: 'named', running: ['builder', 'flow', 'schema'], withheld: [] };

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
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
		const hit = routes[`${method} ${path.split('?')[0]}`];
		if (!hit) return json({ error: 'not found' }, 404);
		return (typeof hit === 'function' ? hit() : hit).clone();
	});
	return { calls, fetch };
}

const FORM = {
	site: 's1',
	site_name: 'Main site',
	path: '/contact',
	block: 'b1',
	label: 'Contact us',
	destination: { schema: 'contact_messages' },
	counts: { new: 1, read: 0, spam: 0 },
};
const SETTINGS = { allowed: true, lifetime_days: 90, show_schemas: [], writes_per_minute: 120, max_writes_per_minute: 120, form_schemas: ['contact_messages'], form_flows: [] };
const SUBMISSION = { id: 'e1', schema: 'contact_messages', state: 'new', created_at: '2026-11-07T10:00:00Z', fields: { email: 'ana@example.com' } };

const ROUTES: Routes = {
	'GET /api/admin/builder/forms': json({ data: [FORM] }),
	'GET /api/admin/builder/settings': json(SETTINGS),
	'GET /api/admin/schemas': json([
		{ name: 'contact_messages', display_name: 'Contact messages' },
		{ name: 'posts', display_name: 'Posts', public_delivery: true },
		{ name: 'lyeve_builder_pages', display_name: 'Pages' },
	]),
	'GET /api/admin/flows': json({ data: [], total: 0 }),
	'GET /api/admin/schemas/presets': json({ presets: [{ id: 'contact', name: 'Contact', description: '', schemas: [] }] }),
	'GET /api/admin/builder/forms/submissions': json({ data: [SUBMISSION], total: 1, limit: 50, offset: 0 }),
};

function loadEvent(routes: Routes, { search = '', plugins = RUNNING as unknown } = {}) {
	const e = engine(routes);
	const url = new URL(`http://admin/admin/forms${search}`);
	return { ...e, event: { fetch: e.fetch, url, request: new Request(url), parent: async () => ({ plugins }) } as never };
}

function actionEvent(routes: Routes, fields: [string, string][] = []) {
	const e = engine(routes);
	const body = new FormData();
	for (const [k, v] of fields) body.append(k, v);
	const url = new URL('http://admin/admin/forms');
	return { ...e, event: { fetch: e.fetch, url, request: new Request(url, { method: 'POST', body }) } as never };
}

type Loaded = Record<string, unknown> & { gate: { state: string }; selected: Record<string, unknown> | null };

describe('forms load', () => {
	it('makes no engine call while the builder plugin does not run', async () => {
		const { event, calls } = loadEvent(ROUTES, { plugins: { state: 'named', running: [], withheld: [] } });
		const out = (await load(event)) as Loaded;
		expect(out.gate).toEqual({ state: 'absent' });
		expect(calls).toEqual([]);
	});

	it('reads the forms, the settings, the content types, the flows and the preset', async () => {
		const { event } = loadEvent(ROUTES);
		const out = (await load(event)) as Loaded;
		expect(out.gate).toEqual({ state: 'ok' });
		expect(out.forms).toEqual([FORM]);
		expect(out.settings).toEqual({ ok: true, value: SETTINGS });
		// The builder's own types never reach the list, and a delivered type is marked.
		expect(out.schemas).toEqual({
			ok: true,
			value: [
				{ name: 'contact_messages', label: 'Contact messages', delivered: false },
				{ name: 'posts', label: 'Posts', delivered: true },
			],
		});
		expect(out.flows).toEqual({ ok: true, value: [] });
		expect(out.presetOffered).toBe(true);
		expect(out.selected).toBeNull();
	});

	it('reports a failed forms read as a gate, never as no forms', async () => {
		const { event } = loadEvent({ ...ROUTES, 'GET /api/admin/builder/forms': json({ error: 'down' }, 503) });
		const out = (await load(event)) as Loaded;
		expect(out.gate).toEqual({ state: 'unavailable' });
	});

	it('leaves flows out without the flow plugin and offers no preset without the schema catalog entry', async () => {
		const { event, calls } = loadEvent(
			{ ...ROUTES, 'GET /api/admin/schemas/presets': json({ presets: [] }) },
			{ plugins: { state: 'named', running: ['builder', 'schema'], withheld: [] } },
		);
		const out = (await load(event)) as Loaded;
		expect(out.flows).toBeNull();
		expect(out.presetOffered).toBe(false);
		expect(calls.some((c) => c.path.startsWith('/api/admin/flows'))).toBe(false);
	});

	it('reads one page of the selected form with its state filter', async () => {
		const { event, calls } = loadEvent(ROUTES, { search: '?site=s1&path=%2Fcontact&block=b1&state=spam&offset=50' });
		const out = (await load(event)) as Loaded;
		const read = calls.find((c) => c.path.startsWith('/api/admin/builder/forms/submissions'));
		const q = new URL(`http://x${read?.path}`).searchParams;
		expect(Object.fromEntries(q)).toEqual({ site: 's1', path: '/contact', block: 'b1', state: 'spam', limit: '50', offset: '50' });
		expect(out.selected).toMatchObject({ state: 'spam', form: FORM, submissions: { ok: true } });
	});

	it('sends no state for All', async () => {
		const { event, calls } = loadEvent(ROUTES, { search: '?site=s1&path=%2Fcontact&block=b1&state=all' });
		await load(event);
		const read = calls.find((c) => c.path.startsWith('/api/admin/builder/forms/submissions'));
		expect(read?.path).not.toContain('state=');
	});
});

describe('forms actions', () => {
	it('saves only the lists the form offered', async () => {
		const { event, calls } = actionEvent({ 'PUT /api/admin/builder/settings': json(SETTINGS) }, [
			['schemas_offered', '1'],
			['form_schemas', 'contact_messages'],
		]);
		expect(await actions.targets(event)).toEqual({ targetsSaved: true });
		expect(calls[0].body).toEqual({ form_schemas: ['contact_messages'] });
	});

	it('lands a refused list on its field in the engine words', async () => {
		const { event } = actionEvent(
			{ 'PUT /api/admin/builder/settings': refusal(422, 'settings_invalid', 'Choose a flow slug of letters.', { field: 'form_flows' }) },
			[['flows_offered', '1'], ['form_flows', 'Bad Slug']],
		);
		const out = (await actions.targets(event)) as { status: number; data: unknown };
		expect(out.status).toBe(422);
		expect(out.data).toEqual({ targetsError: { field: 'form_flows', message: 'Choose a flow slug of letters.' } });
	});

	it('creates the contact type from the preset and allows it', async () => {
		const { event, calls } = actionEvent({
			'GET /api/admin/schemas': json([{ name: 'posts' }]),
			'GET /api/admin/builder/settings': json({ ...SETTINGS, form_schemas: [] }),
			'POST /api/admin/schemas/presets/contact': json({ created: ['contact_messages'] }),
			'PUT /api/admin/builder/settings': json(SETTINGS),
		});
		expect(await actions.setup(event)).toEqual({ setupDone: { created: true } });
		expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ form_schemas: ['contact_messages'] });
	});

	it('only allows the contact type when it exists already', async () => {
		const { event, calls } = actionEvent({
			'GET /api/admin/schemas': json([{ name: 'contact_messages' }]),
			'GET /api/admin/builder/settings': json({ ...SETTINGS, form_schemas: [] }),
			'PUT /api/admin/builder/settings': json(SETTINGS),
		});
		expect(await actions.setup(event)).toEqual({ setupDone: { created: false } });
		expect(calls.some((c) => c.method === 'POST')).toBe(false);
		expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ form_schemas: ['contact_messages'] });
	});

	it('says the preset is missing when the schema plugin answers 404, and saves nothing', async () => {
		const { event, calls } = actionEvent({
			'GET /api/admin/schemas': json([]),
			'GET /api/admin/builder/settings': json({ ...SETTINGS, form_schemas: [] }),
		});
		const out = (await actions.setup(event)) as { status: number; data: unknown };
		expect(out).toMatchObject({ status: 404, data: { setupMissing: true } });
		expect(calls.some((c) => c.method === 'PUT')).toBe(false);
	});

	it('sets a triage state', async () => {
		const { event, calls } = actionEvent({ 'PATCH /api/admin/builder/forms/submissions/e1': json({ id: 'e1', state: 'read' }) }, [
			['id', 'e1'],
			['state', 'read'],
		]);
		expect(await actions.state(event)).toEqual({ stateSet: 'read' });
		expect(calls[0].body).toEqual({ state: 'read' });
	});

	it('refuses a state outside the three without asking the engine', async () => {
		const { event, calls } = actionEvent({}, [['id', 'e1'], ['state', 'archived']]);
		expect(await actions.state(event)).toMatchObject({ status: 400 });
		expect(calls).toEqual([]);
	});

	it('deletes a submission and says when it is already gone', async () => {
		const ok = actionEvent({ 'DELETE /api/admin/builder/forms/submissions/e1': new Response(null, { status: 204 }) }, [['id', 'e1']]);
		expect(await actions.delete(ok.event)).toEqual({ deleted: true });
		const gone = actionEvent({}, [['id', 'e1']]);
		expect(await actions.delete(gone.event)).toMatchObject({ status: 404, data: { entryError: 'This submission no longer exists.' } });
	});

	it('makes no claim about a write that met an outage', async () => {
		const { event } = actionEvent({ 'DELETE /api/admin/builder/forms/submissions/e1': json({ error: 'down' }, 503) }, [['id', 'e1']]);
		const out = (await actions.delete(event)) as { data: { entryError: string } };
		expect(out.data.entryError).toBe('Could not confirm the change. Reload the page to check it, then try again.');
	});
});
