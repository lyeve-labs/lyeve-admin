import { describe, expect, it, vi } from 'vitest';
import type { Cookies } from '@sveltejs/kit';
import { actions, load } from './+page.server';
import type { Variable } from '$lib/api/flows';

type Loaded = Exclude<Awaited<ReturnType<typeof load>>, void>;

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function mockCookies(): Cookies {
	return { get: vi.fn(() => 'tok'), set: vi.fn(), delete: vi.fn(), getAll: vi.fn(() => []), serialize: vi.fn(() => '') } as unknown as Cookies;
}

type Route = (url: string, init?: RequestInit) => Response;

function fetchFor(routes: Record<string, Route>) {
	const calls: { url: string; init?: RequestInit }[] = [];
	const fetch = vi.fn(async (url: string, init?: RequestInit) => {
		const asked = String(url);
		calls.push({ url: asked, init });
		if (asked.includes('/auth/me')) return json({ id: 'u1', roles: ['admin'], disabled: false });
		for (const [needle, route] of Object.entries(routes)) if (asked.includes(needle)) return route(asked, init);
		return json({ error: 'no route' }, 404);
	}) as unknown as typeof globalThis.fetch;
	return { fetch, calls };
}

function loadEvent(routes: Record<string, Route>) {
	const { fetch } = fetchFor(routes);
	return { fetch, cookies: mockCookies(), url: new URL('http://localhost/admin/flows/variables'), parent: async () => ({}) } as never;
}

function actionEvent(form: FormData, routes: Record<string, Route>) {
	const { fetch, calls } = fetchFor(routes);
	return { calls, event: { fetch, cookies: mockCookies(), request: { formData: async () => form }, url: new URL('http://localhost/admin/flows/variables'), params: {} } as never };
}

describe('admin/flows/variables load', () => {
	it('lists the variables, secrets without a value', async () => {
		const result = (await load(
			loadEvent({
				'/variables': () =>
					json({ data: [{ key: 'region', value: 'eu', is_secret: false, updated_at: 'x' }, { key: 'api_key', is_secret: true, updated_at: 'x' }] }),
			})
		)) as Loaded;
		expect(result.variables.map((v: Variable) => v.key)).toEqual(['region', 'api_key']);
		expect(result.variables[1].value).toBeUndefined();
	});

	it('maps a 402 to the locked state', async () => {
		const result = (await load(loadEvent({ '/variables': () => json({ error: 'nope' }, 402) }))) as Loaded;
		expect(result.locked).toBe(true);
		expect(result.loadError).toBeNull();
	});

	it('sends an expired session to the login page with the cookie cleared', async () => {
		const event = loadEvent({ '/variables': () => json({ error: 'unauthorized' }, 401) });
		await expect(load(event)).rejects.toMatchObject({ status: 302, location: '/login' });
		expect((event as { cookies: Cookies }).cookies.delete).toHaveBeenCalledWith('__Host-sys_session', expect.objectContaining({ path: '/' }));
	});

	it('names the role as the reason for a 403', async () => {
		const result = (await load(loadEvent({ '/variables': () => json({ error: 'forbidden' }, 403) }))) as Loaded;
		expect(result.locked).toBe(false);
		expect(result.loadError).toBe('Your role cannot read variables.');
	});

	it('keeps the engine banner for a network failure', async () => {
		const result = (await load(
			loadEvent({
				'/variables': () => {
					throw new TypeError('fetch failed');
				},
			})
		)) as Loaded;
		expect(result.loadError).toContain('could not be read from the engine');
	});

	it('reports a failed read as a static message rather than an empty list', async () => {
		const result = (await load(loadEvent({ '/variables': () => json({ error: 'pq: connection refused' }, 503) }))) as Loaded;
		expect(result.locked).toBe(false);
		expect(result.loadError).toBeTruthy();
		expect(result.loadError).not.toContain('pq:');
	});
});

describe('admin/flows/variables actions', () => {
	it('put upserts the key, value and secret flag', async () => {
		const form = new FormData();
		form.set('key', 'api_key');
		form.set('value', 's3cret');
		form.set('is_secret', 'true');
		const { event, calls } = actionEvent(form, { '/variables': () => json({ key: 'api_key', is_secret: true, updated_at: 'x' }) });
		const result = (await actions.put(event)) as { saved: string };
		expect(result.saved).toBe('api_key');
		const call = calls.find((c) => c.init?.method === 'PUT')!;
		expect(JSON.parse(String(call.init?.body))).toEqual({ key: 'api_key', value: 's3cret', is_secret: true });
	});

	it('put refuses a key the engine would reject', async () => {
		const form = new FormData();
		form.set('key', 'Bad Key');
		form.set('value', 'x');
		const { event, calls } = actionEvent(form, {});
		const result = (await actions.put(event)) as { status: number; data: { key: string } };
		expect(result.status).toBe(400);
		expect(result.data.key).toBe('Bad Key');
		expect(calls.some((c) => c.init?.method === 'PUT')).toBe(false);
	});

	it('put keeps a stored secret when the edit left the value blank', async () => {
		const form = new FormData();
		form.set('key', 'api_key');
		form.set('value', '');
		form.set('is_secret', 'true');
		form.set('existing', 'true');
		const { event, calls } = actionEvent(form, {});
		await actions.put(event);
		expect(calls.some((c) => c.init?.method === 'PUT')).toBe(false);
	});

	it('delete removes by key', async () => {
		const form = new FormData();
		form.set('key', 'region');
		const { event, calls } = actionEvent(form, { '/variables/region': () => new Response(null, { status: 204 }) });
		await actions.delete(event);
		expect(calls.find((c) => c.init?.method === 'DELETE')?.url).toContain('/variables/region');
	});

	it('relays the engine message on refusal', async () => {
		const form = new FormData();
		form.set('key', 'region');
		form.set('value', 'x');
		const { event } = actionEvent(form, { '/variables': () => json({ error: 'value too long' }, 400) });
		const result = (await actions.put(event)) as { data: { error: string } };
		expect(result.data.error).toBe('value too long');
	});
});
