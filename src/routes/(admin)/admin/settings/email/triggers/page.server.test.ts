import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@lyeve-labs/client';

const api = vi.hoisted(() => ({
	listEmailTriggers: vi.fn(),
	listEmailTemplates: vi.fn(),
	getSchemas: vi.fn(),
}));

vi.mock('$lib/server/authz', async () => {
	const { createClient } = await vi.importActual<typeof import('@lyeve-labs/client')>('@lyeve-labs/client');
	return {
		authedClient: (event: { fetch?: typeof fetch }) => createClient(event.fetch ?? globalThis.fetch),
		requireUser: async () => ({ id: 'u1', roles: ['admin'] }),
	};
});
vi.mock('$lib/api/email-triggers', async (orig) => ({
	...(await orig<typeof import('$lib/api/email-triggers')>()),
	listEmailTriggers: api.listEmailTriggers,
	listEmailTemplates: api.listEmailTemplates,
}));
vi.mock('@lyeve-labs/client-rest', () => ({ getSchemas: api.getSchemas }));

const { actions, load } = await import('./+page.server');

type Loaded = Exclude<Awaited<ReturnType<typeof load>>, void>;

beforeEach(() => {
	vi.clearAllMocks();
	api.listEmailTriggers.mockResolvedValue({ triggers: [], events: ['after_create'] });
	api.listEmailTemplates.mockResolvedValue([{ id: 't1', key: 'welcome', subject: 'Hi', status: 'active' }]);
	api.getSchemas.mockResolvedValue([{ name: 'posts' }, { name: 'orders' }]);
});

describe('email triggers load', () => {
	it('reads the triggers, the templates and the schemas', async () => {
		const out = (await load({} as never)) as Loaded;
		expect(out.triggers.ok).toBe(true);
		expect(out.templates).toMatchObject({ ok: true, value: [{ key: 'welcome' }] });
		expect(out.schemas).toEqual({ ok: true, value: ['orders', 'posts'] });
	});

	it('keeps a failed template read apart from a tenant with no templates', async () => {
		api.listEmailTemplates.mockRejectedValue(new ApiError(503, 'down'));
		const out = (await load({} as never)) as Loaded;
		expect(out.templates).toEqual({ ok: false, gate: { state: 'unavailable' } });
		expect(out.triggers.ok).toBe(true);
	});

	it('keeps a refused trigger read as forbidden', async () => {
		api.listEmailTriggers.mockRejectedValue(new ApiError(403, 'forbidden'));
		const out = (await load({} as never)) as Loaded;
		expect(out.triggers).toEqual({ ok: false, gate: { state: 'forbidden' } });
	});
});

type Call = { method: string; path: string; body: unknown };
type Failure = { status: number; data: { action: string; error: string; refused?: unknown } };

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** An action event against a fake engine that records each request and answers it with `reply`. */
function write(fields: Record<string, string>, reply: Response = json({})) {
	const calls: Call[] = [];
	const fetch = vi.fn(async (url: string, init?: RequestInit) => {
		calls.push({ method: init?.method ?? 'GET', path: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined });
		return reply.clone();
	});
	const form = new FormData();
	for (const [k, v] of Object.entries(fields)) form.set(k, v);
	const url = new URL('http://admin/admin/settings/email/triggers');
	return { calls, event: { fetch, url, request: new Request(url, { method: 'POST', body: form }) } as never };
}

const TRIGGER = { name: ' Welcome ', event: 'after_create', schema: '', template_key: 'welcome', to_static: 'a@example.com,\n b@example.com', to_field: '', locale: '' };

describe('email trigger writes', () => {
	it('creates a trigger for every schema when none is chosen', async () => {
		const { event, calls } = write(TRIGGER);
		expect(await actions.save(event)).toEqual({ saved: true });
		expect(calls).toEqual([
			{
				method: 'POST',
				path: '/api/admin/email/triggers',
				body: {
					name: 'Welcome',
					event: 'after_create',
					schema: '*',
					template_key: 'welcome',
					to_static: ['a@example.com', 'b@example.com'],
					to_field: '',
					locale: '',
					enabled: true,
				},
			},
		]);
	});

	it('saves an existing trigger under its id', async () => {
		const { event, calls } = write({ ...TRIGGER, id: 't1', enabled: 'false' });
		await actions.save(event);
		expect(calls).toEqual([expect.objectContaining({ method: 'PUT', path: '/api/admin/email/triggers/t1', body: expect.objectContaining({ enabled: false }) })]);
	});

	it('asks for a recipient before it sends anything', async () => {
		const { event, calls } = write({ ...TRIGGER, to_static: '' });
		expect(((await actions.save(event)) as Failure).data).toEqual({
			action: 'save',
			error: 'Give at least one recipient, a fixed address or a field of the record.',
		});
		expect(calls).toEqual([]);
	});

	it('keeps the status of a field the engine rejected', async () => {
		const { event } = write(TRIGGER, json({ error: 'template welcome does not exist' }, 422));
		const out = (await actions.save(event)) as Failure;
		expect(out.status).toBe(422);
		expect(out.data).toEqual({ action: 'save', error: 'template welcome does not exist' });
	});

	it('carries a license refusal of a delete with its action', async () => {
		const { event } = write({ id: 't1' }, json({ error: 'feature_not_licensed', feature: 'email-pro' }, 402));
		const out = (await actions.delete(event)) as Failure;
		expect(out.status).toBe(402);
		expect(out.data.action).toBe('delete');
		expect(out.data.refused).toMatchObject({ kind: 'feature' });
	});

	it('deletes the named trigger', async () => {
		const { event, calls } = write({ id: 't1' });
		expect(await actions.delete(event)).toEqual({ deleted: 't1' });
		expect(calls).toEqual([{ method: 'DELETE', path: '/api/admin/email/triggers/t1', body: undefined }]);
	});

	it('names nothing to delete without a request', async () => {
		const { event, calls } = write({});
		expect(((await actions.delete(event)) as Failure).data).toEqual({ action: 'delete', error: 'Choose a trigger.' });
		expect(calls).toEqual([]);
	});

	it.each([
		['save', 'The trigger could not be saved.'],
		['delete', 'The trigger could not be deleted.'],
	] as const)('keeps outage detail off the page on %s', async (name, sentence) => {
		const { event } = write({ ...TRIGGER, id: 't1' }, json({ error: 'dial tcp 10.0.0.4:5432' }, 503));
		const out = (await actions[name](event)) as Failure;
		expect(out.status).toBe(400);
		expect(out.data).toEqual({ action: name, error: sentence });
	});
});
