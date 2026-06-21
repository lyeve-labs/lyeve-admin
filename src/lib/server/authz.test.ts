import { describe, it, expect, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { authedClient, authedHeaders, requireUser, requireRole, stripProtectedFields } from './authz';

// event stub

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' },
	});
}

function stubEvent(opts: { token?: string | null; fetchImpl?: typeof fetch } = {}): RequestEvent {
	const token = 'token' in opts ? opts.token : 'sess-tok';
	return {
		cookies: { get: vi.fn().mockReturnValue(token) },
		fetch: opts.fetchImpl ?? vi.fn(),
	} as unknown as RequestEvent;
}

/**
 * An event whose cookie jar answers per name, so a test can hold a session
 * without a CSRF cookie. The single-value stub above cannot express that, and
 * the absent-cookie case is the one that matters: an empty header fails the
 * check it exists to pass.
 */
function stubEventWithCookies(jar: Record<string, string | undefined>): RequestEvent {
	return {
		cookies: { get: vi.fn((name: string) => jar[name]) },
		fetch: vi.fn(),
	} as unknown as RequestEvent;
}

describe('authedHeaders', () => {
	it('echoes the double-submit CSRF token from the secure cookie', () => {
		const headers = authedHeaders(
			stubEventWithCookies({ '__Host-sys_session': 'sess-tok', '__Host-csrf': 'csrf-tok' })
		);
		expect(headers.Authorization).toBe('Bearer sess-tok');
		expect(headers['X-CSRF-Token']).toBe('csrf-tok');
	});

	it('falls back to the insecure cookie name, which is how local runs present it', () => {
		const headers = authedHeaders(
			stubEventWithCookies({ '__Host-sys_session': 'sess-tok', csrf: 'plain-tok' })
		);
		expect(headers['X-CSRF-Token']).toBe('plain-tok');
	});

	it('prefers the secure name when both are present', () => {
		const headers = authedHeaders(
			stubEventWithCookies({
				'__Host-sys_session': 'sess-tok',
				'__Host-csrf': 'secure-tok',
				csrf: 'plain-tok',
			})
		);
		expect(headers['X-CSRF-Token']).toBe('secure-tok');
	});

	it('omits the header entirely when no CSRF cookie was sent', () => {
		const headers = authedHeaders(stubEventWithCookies({ '__Host-sys_session': 'sess-tok' }));
		expect(headers.Authorization).toBe('Bearer sess-tok');
		expect('X-CSRF-Token' in headers).toBe(false);
	});

	it('throws 401 without a session cookie', () => {
		const err = (() => {
			try {
				authedHeaders(stubEventWithCookies({}));
			} catch (e) {
				return e as { status?: number };
			}
		})();
		expect(err?.status).toBe(401);
	});
});

describe('authedClient CSRF', () => {
	it('sends the CSRF token on a write, which the engine refuses without', async () => {
		const fetchImpl = vi.fn(
			async (_url: string, _init: RequestInit): Promise<Response> => jsonResponse({ ok: true })
		) as unknown as typeof fetch;
		const event = {
			cookies: {
				get: vi.fn((name: string) =>
					({ '__Host-sys_session': 'sess-tok', '__Host-csrf': 'csrf-tok' })[name]
				),
			},
			fetch: fetchImpl,
		} as unknown as RequestEvent;

		await authedClient(event).put('/api/admin/config', { values: {} });

		const mock = fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } };
		const headers = mock.mock.calls[0][1].headers as Record<string, string>;
		expect(headers['X-CSRF-Token']).toBe('csrf-tok');
	});
});

// authedClient

describe('authedClient', () => {
	it('throws 401 when there is no session cookie', async () => {
		const event = stubEvent({ token: null });
		const err = (await Promise.resolve()
			.then(() => authedClient(event))
			.catch((e: unknown) => e)) as { status?: number };
		expect(err.status).toBe(401);
	});

	it('forwards the session token as a Bearer Authorization header', async () => {
		const fetchImpl = vi.fn(
			async (_url: string, _init: RequestInit): Promise<Response> => jsonResponse({ ok: true })
		) as unknown as typeof fetch;
		const event = stubEvent({ token: 'sess-tok', fetchImpl });

		const client = authedClient(event);
		await client.get('/api/admin/thing');

		const mock = fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } };
		const [url, init] = mock.mock.calls[0];
		expect(url).toBe('/api/admin/thing');
		expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sess-tok');
	});
});

// requireUser

describe('requireUser', () => {
	it('returns the current user when /me succeeds', async () => {
		const user = { id: 'u1', email: 'a@b.co', roles: ['admin'], tenant_id: 't', disabled: false, created_at: '' };
		const fetchImpl = vi.fn(
			async (_url: string, _init: RequestInit): Promise<Response> => jsonResponse(user)
		) as unknown as typeof fetch;
		const out = await requireUser(stubEvent({ fetchImpl }));
		expect(out).toEqual(user);
	});

	it('throws 401 when /me responds unauthorized', async () => {
		const fetchImpl = vi.fn(
			async (_url: string, _init: RequestInit): Promise<Response> => jsonResponse({ error: 'nope' }, 401)
		) as unknown as typeof fetch;
		const err = (await requireUser(stubEvent({ fetchImpl })).catch((e: unknown) => e)) as {
			status?: number;
		};
		expect(err.status).toBe(401);
	});

	it('throws 401 when there is no session cookie', async () => {
		const err = (await requireUser(stubEvent({ token: null })).catch((e: unknown) => e)) as {
			status?: number;
		};
		expect(err.status).toBe(401);
	});
});

// requireRole

describe('requireRole', () => {
	function withRoles(roles: string[]): typeof fetch {
		const user = { id: 'u1', email: 'a@b.co', roles, tenant_id: 't', disabled: false, created_at: '' };
		return vi.fn(
			async (_url: string, _init: RequestInit): Promise<Response> => jsonResponse(user)
		) as unknown as typeof fetch;
	}

	it('returns the user when they hold one of the required roles', async () => {
		const out = await requireRole(stubEvent({ fetchImpl: withRoles(['editor']) }), ['admin', 'editor']);
		expect(out.roles).toContain('editor');
	});

	it('throws 403 when the user lacks every required role', async () => {
		const err = (await requireRole(stubEvent({ fetchImpl: withRoles(['reader']) }), ['admin']).catch(
			(e: unknown) => e
		)) as { status?: number };
		expect(err.status).toBe(403);
	});

	it('throws 401 (not 403) when unauthenticated', async () => {
		const err = (await requireRole(stubEvent({ token: null }), ['admin']).catch((e: unknown) => e)) as {
			status?: number;
		};
		expect(err.status).toBe(401);
	});
});

// stripProtectedFields

describe('stripProtectedFields', () => {
	it('removes server-controlled fields', () => {
		const out = stripProtectedFields({
			id: 'x',
			_id: 'y',
			status: 'published',
			_status: 'draft',
			created_by: 'u',
			updated_by: 'u',
			created_at: 't',
			updated_at: 't',
			tenant_id: 't',
			system: true,
			title: 'keep me',
		});
		expect(out).toEqual({ title: 'keep me' });
	});

	it('leaves an ordinary payload untouched', () => {
		const data = { title: 'Hello', body: 'World', published: true };
		expect(stripProtectedFields(data)).toEqual(data);
	});

	it('returns an empty object when every field is protected', () => {
		expect(stripProtectedFields({ id: '1', tenant_id: 't' })).toEqual({});
	});
});
