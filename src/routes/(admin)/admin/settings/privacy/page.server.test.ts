import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiError } from '@lyeve-labs/client';

const engine = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));

vi.mock('$lib/server/authz', () => ({
	authedClient: vi.fn(() => engine),
	requireRole: vi.fn(async () => ({ id: 'u1', roles: ['admin'] })),
}));

import { load, actions } from './+page.server';

type Loaded = Exclude<Awaited<ReturnType<typeof load>>, void>;

const named = (running: string[]) => ({ state: 'named', running, withheld: [] });

function loadEvent(plugins: unknown = named(['schema']), roles: string[] = ['admin']) {
	return {
		url: new URL('http://admin/admin/settings/privacy'),
		cookies: {},
		fetch: vi.fn(),
		parent: async () => ({ user: { roles }, plugins, pluginStatus: null }),
	} as never;
}

function formEvent(fields: Record<string, string>) {
	const body = new FormData();
	for (const [k, v] of Object.entries(fields)) body.set(k, v);
	return {
		request: new Request('http://admin/admin/settings/privacy', { method: 'POST', body }),
		cookies: {},
		fetch: vi.fn(),
	} as never;
}

beforeEach(() => vi.clearAllMocks());

describe('privacy settings load', () => {
	it('carries the stored form erasure mode', async () => {
		engine.get.mockResolvedValue({ mode: 'soft' });
		const result = (await load(loadEvent())) as Loaded;
		expect(engine.get).toHaveBeenCalledWith('/api/admin/schemas/form-erasure');
		expect(result.formErasure).toEqual({ ok: true, value: { mode: 'soft' } });
	});

	it('says the plugin is stopped, without asking, rather than drawing nothing', async () => {
		const result = (await load(loadEvent(named([])))) as Loaded;
		expect(engine.get).not.toHaveBeenCalled();
		expect(result.formErasure).toEqual({ ok: false, stopped: { state: 'unexplained' } });
	});

	it('says a plugin withheld from this tenant is withheld', async () => {
		const result = (await load(loadEvent({ state: 'named', running: [], withheld: ['schema'] }))) as Loaded;
		expect(result.formErasure).toEqual({ ok: false, stopped: { state: 'withheld' } });
	});

	it('answers 403 to a role that may not use the page, without asking the engine', async () => {
		await expect(load(loadEvent(named(['schema']), ['editor']))).rejects.toMatchObject({ status: 403 });
		expect(engine.get).not.toHaveBeenCalled();
	});

	it('opens for a super admin', async () => {
		engine.get.mockResolvedValue({ mode: 'auto' });
		const result = (await load(loadEvent(named(['schema']), ['super_admin']))) as Loaded;
		expect(result.formErasure).toEqual({ ok: true, value: { mode: 'auto' } });
	});

	it('leaves the setting out on an engine whose route is not there', async () => {
		engine.get.mockRejectedValue(new ApiError(404, 'not found'));
		const result = (await load(loadEvent())) as Loaded;
		expect(result.formErasure).toBeNull();
	});

	it('reports a failed read as a failure, never as the default', async () => {
		engine.get.mockRejectedValue(new ApiError(500, 'boom'));
		const result = (await load(loadEvent())) as Loaded;
		expect(result.formErasure).toMatchObject({ ok: false, gate: { state: 'error' } });
	});

	it('reports an outage as one', async () => {
		engine.get.mockRejectedValue(new ApiError(503, 'down'));
		const result = (await load(loadEvent())) as Loaded;
		expect(result.formErasure).toEqual({ ok: false, gate: { state: 'unavailable' } });
	});

	it('says once that the session names no tenant, and draws no card', async () => {
		engine.get.mockRejectedValue(new ApiError(400, 'the form erasure mode belongs to a tenant, and the request names none'));
		const result = (await load(loadEvent())) as Loaded;
		expect(result).toEqual({ noTenant: true, formErasure: null });
	});
});

describe('privacy settings: form erasure save', () => {
	it('sends the chosen mode', async () => {
		engine.put.mockResolvedValue({ mode: 'hard' });
		const result = await actions.erasure(formEvent({ mode: 'hard' }));
		expect(engine.put).toHaveBeenCalledWith('/api/admin/schemas/form-erasure', { mode: 'hard' });
		expect(result).toEqual({ action: 'erasure', saved: true });
	});

	it('refuses a mode the engine does not know without asking it', async () => {
		const result = (await actions.erasure(formEvent({ mode: 'delete' }))) as { status: number; data: { action: string } };
		expect(engine.put).not.toHaveBeenCalled();
		expect(result.status).toBe(400);
		expect(result.data.action).toBe('erasure');
	});

	it('reports an outage as one, and keeps its engine detail off the page', async () => {
		engine.put.mockRejectedValue(new ApiError(503, 'pq: connection refused'));
		const result = (await actions.erasure(formEvent({ mode: 'auto' }))) as { status: number; data: { error: string } };
		expect(result.status).toBe(503);
		expect(result.data.error).not.toContain('pq');
		expect(result.data.error).toContain('could not be saved');
	});
});
