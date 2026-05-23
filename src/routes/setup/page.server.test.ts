import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Cookies } from '@sveltejs/kit';
import { load, actions } from './+page.server';
import { resetRateLimitStore } from '$lib/server/rate-limit';

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function mockCookies(): Cookies {
	return {
		get: vi.fn(() => undefined),
		set: vi.fn(),
		delete: vi.fn(),
		getAll: vi.fn(() => []),
		serialize: vi.fn(() => ''),
	} as unknown as Cookies;
}

function catchRedirect(fn: () => unknown): Promise<{ status: number; location: string }> {
	return Promise.resolve(fn()).then(
		() => {
			throw new Error('expected redirect but got success');
		},
		(e: unknown) => {
			const err = e as { status?: number; location?: string };
			if (err.status && err.location) return { status: err.status, location: err.location };
			throw e;
		},
	);
}

function fetchReturning(body: unknown, status = 200) {
	return vi.fn(async (_url: string, _init?: RequestInit) => json(body, status)) as unknown as typeof globalThis.fetch;
}

function loadEvent(fetch: typeof globalThis.fetch, search = '') {
	return { fetch, url: new URL(`http://localhost/setup${search}`) } as never;
}

function form(data: Record<string, string>): FormData {
	const fd = new FormData();
	for (const [k, v] of Object.entries(data)) fd.set(k, v);
	return fd;
}

function actionEvent(fields: Record<string, string>, fetch: unknown, cookies = mockCookies()) {
	return {
		getClientAddress: () => '127.0.0.1',
		request: { formData: () => Promise.resolve(form(fields)) },
		fetch,
		cookies,
	} as never;
}

describe('setup load', () => {
	it('reports an unreachable engine as its own state', async () => {
		const fetch = vi.fn(async () => {
			throw new Error('connect ECONNREFUSED');
		}) as unknown as typeof globalThis.fetch;
		expect(await load(loadEvent(fetch))).toEqual({ state: 'unreachable', tokenSource: null, next: null });
	});

	it('reports setup mode with where the token is', async () => {
		const result = await load(loadEvent(fetchReturning({ setup_required: true, mode: 'setup', token_source: 'log' })));
		expect(result).toEqual({ state: 'setup_mode', tokenSource: 'log', next: null });
	});

	it('reports an engine waiting for its first admin', async () => {
		const result = await load(loadEvent(fetchReturning({ setup_required: true, token_source: 'env' })));
		expect(result).toEqual({ state: 'needs_admin', tokenSource: 'env', next: null });
	});

	it('sends a finished install to sign in', async () => {
		const r = await catchRedirect(() => load(loadEvent(fetchReturning({ setup_required: false }))));
		expect(r.location).toBe('/login');
	});

	it('returns to the page the gate interrupted once the engine is back', async () => {
		const r = await catchRedirect(() =>
			load(loadEvent(fetchReturning({ setup_required: false }), '?next=%2Fadmin%2Fusers')),
		);
		expect(r.location).toBe('/admin/users');
	});

	it('ignores a next that leaves the origin', async () => {
		const r = await catchRedirect(() =>
			load(loadEvent(fetchReturning({ setup_required: false }), '?next=%2F%2Fevil.example')),
		);
		expect(r.location).toBe('/login');
	});
});

describe('setup actions.status', () => {
	beforeEach(() => resetRateLimitStore());

	it('refuses to call the engine without a token', async () => {
		const fetch = vi.fn();
		const result = (await actions.status(actionEvent({}, fetch))) as { status: number };
		expect(result.status).toBe(400);
		expect(fetch).not.toHaveBeenCalled();
	});

	it('sends the token in the header and returns what the engine reports', async () => {
		const body = { mode: 'setup', missing: [], secrets_included: true, env: 'X=1\n', yaml: 'x: 1\n', restart: [] };
		const fetch = fetchReturning(body);
		const result = await actions.status(actionEvent({ setup_token: 'tok-from-log' }, fetch));
		expect(result).toEqual({ status: body });

		const [url, init] = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0];
		expect(String(url)).toContain('/api/admin/setup/status');
		expect(new Headers(init.headers).get('X-Setup-Token')).toBe('tok-from-log');
	});

	it('says the token was refused on 401', async () => {
		const fetch = fetchReturning({ code: 'AUTH_SETUP_TOKEN_INVALID' }, 401);
		const result = (await actions.status(actionEvent({ setup_token: 'wrong' }, fetch))) as {
			status: number;
			data: { error: string };
		};
		expect(result.status).toBe(401);
		expect(result.data.error).toContain('setup token');
	});

	it('treats a 404 as the engine having left setup mode', async () => {
		const result = await actions.status(actionEvent({ setup_token: 'tok' }, fetchReturning({}, 404)));
		expect(result).toEqual({ status: null });
	});
});

describe('setup actions.create', () => {
	beforeEach(() => resetRateLimitStore());

	const valid = { setup_token: 'tok-from-log', email: 'a@b.co', password: 'password123', confirm: 'password123' };

	it('refuses to call the engine without a setup token', async () => {
		const fetch = vi.fn();
		const { setup_token: _omit, ...rest } = valid;
		const result = await actions.create(actionEvent(rest, fetch));
		expect(result).toEqual({ error: 'The setup token is required.' });
		expect(fetch).not.toHaveBeenCalled();
	});

	it('returns error when email is missing', async () => {
		const result = await actions.create(actionEvent({ setup_token: 't', password: 'pw', confirm: 'pw' }, vi.fn()));
		expect(result).toEqual({ error: 'Email and password are required.' });
	});

	it('returns error when passwords do not match', async () => {
		const result = await actions.create(actionEvent({ ...valid, confirm: 'other-password' }, vi.fn()));
		expect(result).toEqual({ error: 'Passwords do not match.' });
	});

	it('returns error when password is too short', async () => {
		const result = await actions.create(actionEvent({ ...valid, password: 'short', confirm: 'short' }, vi.fn()));
		expect(result).toEqual({ error: 'Password must be at least 8 characters.' });
	});

	it('sets the session cookie, sends the token, and redirects on success', async () => {
		const fetch = fetchReturning({ user: { id: 'u1' }, token: 'setup-session-token' });
		const cookies = mockCookies();

		const r = await catchRedirect(() => actions.create(actionEvent(valid, fetch, cookies)));

		expect(cookies.set).toHaveBeenCalledWith('__Host-sys_session', 'setup-session-token', expect.objectContaining({ path: '/' }));
		const sent = JSON.parse(String((fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0][1].body));
		expect(sent).toEqual({ email: 'a@b.co', password: 'password123', setup_token: 'tok-from-log' });
		expect(r.location).toBe('/admin');
	});

	it('says the token was refused when the engine answers 401', async () => {
		const cookies = mockCookies();
		const result = (await actions.create(actionEvent(valid, fetchReturning({}, 401), cookies))) as {
			status: number;
			data: { error: string };
		};
		expect(result.status).toBe(401);
		expect(result.data.error).toContain('setup token');
		expect(cookies.set).not.toHaveBeenCalled();
	});

	it('sends the operator to sign in when setup is already complete', async () => {
		const r = await catchRedirect(() => actions.create(actionEvent(valid, fetchReturning({}, 409))));
		expect(r.location).toBe('/login');
	});

	it('returns a generic error when the engine fails otherwise (no backend detail leaked)', async () => {
		const fetch = vi.fn(async () => {
			throw new Error('driver: connection reset');
		});
		const result = await actions.create(actionEvent(valid, fetch));
		expect(result).toEqual({ error: 'Setup failed.' });
	});
});
