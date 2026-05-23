import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Cookies } from '@sveltejs/kit';
import { load, actions } from './+page.server';
import { resetRateLimitStore } from '$lib/server/rate-limit';

// helpers

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' },
	});
}

interface CookieStore {
	[key: string]: string;
}

function mockCookies(initial: CookieStore = {}): Cookies {
	const store = { ...initial };
	return {
		get: vi.fn((name: string) => store[name] ?? undefined),
		set: vi.fn((name: string, value: string, _opts?: object) => {
			store[name] = value;
		}),
		delete: vi.fn((name: string, _opts?: object) => {
			delete store[name];
		}),
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
		}
	);
}

// Every action test needs getClientAddress, because the action rate-limits per IP.
function mockEvent(overrides: Record<string, unknown> = {}) {
	return {
		getClientAddress: () => '127.0.0.1',
		...overrides,
	};
}

// load

describe('login/+page.server.ts load', () => {
	it('redirects to the dashboard when the session cookie still authenticates', async () => {
		const fetch = vi.fn(async (url: string, _init: RequestInit) => {
			const s = String(url);
			if (s.includes('/api/admin/setup')) return json({ setup_required: false });
			if (s.includes('/api/admin/auth/me')) return json({ id: 'u1', email: 'a@b.co', roles: ['admin'] });
			return json({});
		}) as unknown as typeof globalThis.fetch;
		const cookies = mockCookies({ '__Host-sys_session': 'valid-token' });

		const r = await catchRedirect(() => load({ fetch, cookies } as never));
		expect(r.status).toBe(302);
		expect(r.location).toBe('/admin');
	});

	it('clears a revoked session cookie and renders the form instead of redirecting', async () => {
		// Logging out elsewhere revokes the token while the cookie stays put.
		// Redirecting its holder to /admin sends them to a guard that redirects
		// back here, and the two bounce until the browser gives up.
		const fetch = vi.fn(async (url: string, _init: RequestInit) => {
			const s = String(url);
			if (s.includes('/api/admin/setup')) return json({ setup_required: false });
			if (s.includes('/api/admin/auth/me')) return json({ error: 'unauthorized' }, 401);
			if (s.includes('/api/admin/auth/oauth-providers')) return json([]);
			return json({});
		}) as unknown as typeof globalThis.fetch;
		const cookies = mockCookies({ '__Host-sys_session': 'revoked-token' });

		const result = await load({ fetch, cookies } as never);

		expect(result).toEqual({ oauthProviders: [], samlProviders: [] });
		expect(cookies.delete).toHaveBeenCalledWith('__Host-sys_session', {
			path: '/',
			httpOnly: true,
			secure: true,
			sameSite: 'strict',
		});
	});

	it('returns no providers when not logged in and no setup required (happy path)', async () => {
		const fetch = vi.fn(async (url: string, _init: RequestInit) => {
			const s = String(url);
			if (s.includes('/api/admin/setup')) return json({ setup_required: false });
			if (s.includes('/api/admin/auth/oauth-providers')) return json([]);
			return json({});
		}) as unknown as typeof globalThis.fetch;
		const cookies = mockCookies();

		const result = await load({ fetch, cookies } as never);
		expect(result).toEqual({ oauthProviders: [], samlProviders: [] });
	});

	it('returns oauthProviders when providers endpoint responds', async () => {
		const fetch = vi.fn(async (url: string, _init: RequestInit) => {
			const s = String(url);
			if (s.includes('/api/admin/setup')) return json({ setup_required: false });
			if (s.includes('/api/admin/auth/oauth-providers')) return json([{ name: 'github' }, { name: 'google' }]);
			return json({});
		}) as unknown as typeof globalThis.fetch;
		const cookies = mockCookies();

		const result = await load({ fetch, cookies } as never);
		expect(result).toEqual({ oauthProviders: ['github', 'google'], samlProviders: [] });
	});

	it('returns samlProviders when the saml route responds', async () => {
		const fetch = vi.fn(async (url: string, _init: RequestInit) => {
			const s = String(url);
			if (s.includes('/api/admin/setup')) return json({ setup_required: false });
			if (s.includes('/api/admin/auth/oauth-providers')) return json([]);
			if (s.includes('/api/admin/auth/saml-providers')) return json([{ name: 'Azure AD' }]);
			return json({});
		}) as unknown as typeof globalThis.fetch;
		const cookies = mockCookies();

		const result = await load({ fetch, cookies } as never);
		expect(result).toEqual({ oauthProviders: [], samlProviders: ['Azure AD'] });
	});

	// A refused provider route is not an error on the login page: somebody
	// with a password still has to be able to get in.
	it('renders the password form when the sso routes refuse', async () => {
		const fetch = vi.fn(async (url: string, _init: RequestInit) => {
			const s = String(url);
			if (s.includes('/api/admin/setup')) return json({ setup_required: false });
			if (s.includes('/api/admin/auth/oauth-providers')) return json({ error: 'not found' }, 404);
			if (s.includes('/api/admin/auth/saml-providers')) return json({ error: 'not enabled' }, 402);
			return json({});
		}) as unknown as typeof globalThis.fetch;
		const cookies = mockCookies();

		const result = await load({ fetch, cookies } as never);
		expect(result).toEqual({ oauthProviders: [], samlProviders: [] });
	});
});

// actions.default

describe('login/+page.server.ts actions.default', () => {
	beforeEach(() => {
		resetRateLimitStore();
	});

	it('returns error when email and password are missing', async () => {
		const formData = new FormData();
		const result = await actions.default(mockEvent({
			request: { formData: () => Promise.resolve(formData) } as never,
			fetch: vi.fn() as never,
			cookies: mockCookies(),
		}) as never);
		expect(result).toEqual({ error: 'Email and password are required.' });
	});

	it('sets session cookie and redirects on successful login', async () => {
		const token = 'new-session-token';
		const fetch = vi.fn(async (_url: string, _init: RequestInit) =>
			json({ user: { id: 'u1' }, token })
		) as unknown as typeof globalThis.fetch;
		const cookies = mockCookies();
		const formData = new FormData();
		formData.set('email', 'a@b.co');
		formData.set('password', 'correct');

		const r = await catchRedirect(() =>
			actions.default(mockEvent({
				request: { formData: () => Promise.resolve(formData) } as never,
				fetch,
				cookies,
			}) as never)
		);

		expect(cookies.set).toHaveBeenCalledWith(
			'__Host-sys_session',
			token,
			// Without Secure the browser rejects the __Host- prefix outright and
			// the login succeeds while leaving the caller signed out.
			expect.objectContaining({ path: '/', secure: true, httpOnly: true, sameSite: 'strict' })
		);
		expect(r.status).toBe(302);
		expect(r.location).toBe('/admin');
	});

	it('returns to the admin page that sent the visitor to sign in', async () => {
		const fetch = vi.fn(async (_url: string, _init: RequestInit) =>
			json({ user: { id: 'u1' }, token: 't' })
		) as unknown as typeof globalThis.fetch;
		const formData = new FormData();
		formData.set('email', 'a@b.co');
		formData.set('password', 'correct');
		const url = new URL('http://admin.test/login?next=' + encodeURIComponent('/admin/device?code=WDJB-MJHT'));

		const r = await catchRedirect(() =>
			actions.default(mockEvent({
				request: { formData: () => Promise.resolve(formData) } as never,
				fetch,
				cookies: mockCookies(),
				url,
			}) as never)
		);
		expect(r.location).toBe('/admin/device?code=WDJB-MJHT');
	});

	it('ignores a return target that leaves the admin', async () => {
		for (const next of ['https://evil.example/admin', '//evil.example', '/api/admin/users', '/adminx']) {
			const fetch = vi.fn(async (_url: string, _init: RequestInit) =>
				json({ user: { id: 'u1' }, token: 't' })
			) as unknown as typeof globalThis.fetch;
			const formData = new FormData();
			formData.set('email', 'a@b.co');
			formData.set('password', 'correct');
			const url = new URL('http://admin.test/login?next=' + encodeURIComponent(next));
			const r = await catchRedirect(() =>
				actions.default(mockEvent({
					request: { formData: () => Promise.resolve(formData) } as never,
					fetch,
					cookies: mockCookies(),
					url,
				}) as never)
			);
			expect(r.location, next).toBe('/admin');
		}
	});

	it('returns MFA challenge when login response indicates MFA required', async () => {
		const fetch = vi.fn(async (_url: string, _init: RequestInit) =>
			json({ mfa_required: true, challenge_token: 'ch-tok' })
		) as unknown as typeof globalThis.fetch;
		const cookies = mockCookies();
		const formData = new FormData();
		formData.set('email', 'a@b.co');
		formData.set('password', 'correct');

		const result = await actions.default(mockEvent({
			request: { formData: () => Promise.resolve(formData) } as never,
			fetch,
			cookies,
		}) as never);

		expect(result).toEqual({ mfa_required: true, challenge_token: 'ch-tok' });
	});

	it('returns generic error when login API throws (no backend detail leaked)', async () => {
		const fetch = vi.fn(async (_url: string, _init: RequestInit) => {
			throw new Error('invalid credentials');
		}) as unknown as typeof globalThis.fetch;
		const cookies = mockCookies();
		const formData = new FormData();
		formData.set('email', 'a@b.co');
		formData.set('password', 'wrong');

		const result = await actions.default(mockEvent({
			request: { formData: () => Promise.resolve(formData) } as never,
			fetch,
			cookies,
		}) as never);

		expect(result).toEqual({ error: 'Invalid email or password.' });
	});

	// The engine rate-limits login at 5 attempts. Reporting that as a bad
	// password sends people to reset a password that was never wrong, and
	// reporting a 5xx the same way hides an outage.
	it('reports the engine rate limit as a rate limit, not a bad password', async () => {
		const fetch = vi.fn(async (_url: string, _init: RequestInit) =>
			json({ error: 'rate limit exceeded' }, 429)
		) as unknown as typeof globalThis.fetch;
		const formData = new FormData();
		formData.set('email', 'a@b.co');
		formData.set('password', 'right-password');

		const result = await actions.default(mockEvent({
			request: { formData: () => Promise.resolve(formData) } as never,
			fetch,
			cookies: mockCookies(),
		}) as never) as { status: number; data: { error: string } };

		expect(result.status).toBe(429);
		expect(result.data.error).toMatch(/too many attempts/i);
	});

	it('reports an engine outage as unavailable, not a bad password', async () => {
		const fetch = vi.fn(async (_url: string, _init: RequestInit) =>
			json({ error: 'service unavailable' }, 503)
		) as unknown as typeof globalThis.fetch;
		const formData = new FormData();
		formData.set('email', 'a@b.co');
		formData.set('password', 'right-password');

		const result = await actions.default(mockEvent({
			request: { formData: () => Promise.resolve(formData) } as never,
			fetch,
			cookies: mockCookies(),
		}) as never) as { status: number; data: { error: string } };

		expect(result.status).toBe(503);
		expect(result.data.error).toMatch(/unavailable/i);
	});

	it('still reports a rejected credential as a rejected credential', async () => {
		const fetch = vi.fn(async (_url: string, _init: RequestInit) =>
			json({ error: 'Invalid email or password.' }, 401)
		) as unknown as typeof globalThis.fetch;
		const formData = new FormData();
		formData.set('email', 'a@b.co');
		formData.set('password', 'wrong');

		const result = await actions.default(mockEvent({
			request: { formData: () => Promise.resolve(formData) } as never,
			fetch,
			cookies: mockCookies(),
		}) as never);

		expect(result).toEqual({ error: 'Invalid email or password.' });
	});

	// MFA lockout and challenge exhaustion both return 429. Calling either an
	// invalid code tells the user to keep retrying the one thing that cannot work.
	it('MFA step: reports lockout as lockout, not an invalid code', async () => {
		const fetch = vi.fn(async (_url: string, _init: RequestInit) =>
			json({ error: 'locked out' }, 429)
		) as unknown as typeof globalThis.fetch;
		const formData = new FormData();
		formData.set('challenge_token', 'ch-tok');
		formData.set('code', '123456');

		const result = await actions.default(mockEvent({
			request: { formData: () => Promise.resolve(formData) } as never,
			fetch,
			cookies: mockCookies(),
		}) as never) as { status: number; data: { error: string } };

		expect(result.status).toBe(429);
		expect(result.data.error).toMatch(/too many verification attempts/i);
	});

	it('MFA step: returns error when code is missing', async () => {
		const cookies = mockCookies();
		const formData = new FormData();
		formData.set('challenge_token', 'ch-tok');

		const result = await actions.default(mockEvent({
			request: { formData: () => Promise.resolve(formData) } as never,
			fetch: vi.fn() as never,
			cookies,
		}) as never);

		expect(result).toEqual({ error: 'Verification code is required.', mfa_required: true, challenge_token: 'ch-tok' });
	});

	it('MFA step: sets cookie and redirects on successful MFA verification', async () => {
		const token = 'mfa-session-token';
		const fetch = vi.fn(async (_url: string, _init: RequestInit) =>
			json({ token })
		) as unknown as typeof globalThis.fetch;
		const cookies = mockCookies();
		const formData = new FormData();
		formData.set('challenge_token', 'ch-tok');
		formData.set('code', '123456');

		const r = await catchRedirect(() =>
			actions.default(mockEvent({
				request: { formData: () => Promise.resolve(formData) } as never,
				fetch,
				cookies,
			}) as never)
		);

		expect(cookies.set).toHaveBeenCalledWith(
			'__Host-sys_session',
			token,
			// Without Secure the browser rejects the __Host- prefix outright and
			// the login succeeds while leaving the caller signed out.
			expect.objectContaining({ path: '/', secure: true, httpOnly: true, sameSite: 'strict' })
		);
		expect(r.status).toBe(302);
		expect(r.location).toBe('/admin');
	});

	it('MFA step: returns generic error when MFA verification fails (no backend detail leaked)', async () => {
		const fetch = vi.fn(async (_url: string, _init: RequestInit) => {
			throw new Error('Invalid code.');
		}) as unknown as typeof globalThis.fetch;
		const cookies = mockCookies();
		const formData = new FormData();
		formData.set('challenge_token', 'ch-tok');
		formData.set('code', '000000');

		const result = await actions.default(mockEvent({
			request: { formData: () => Promise.resolve(formData) } as never,
			fetch,
			cookies,
		}) as never);

		expect(result).toEqual({ error: 'Invalid code.', mfa_required: true, challenge_token: 'ch-tok' });
	});
});

// The captcha plugin challenges the login after repeated failures. The form
// has to carry the challenge to the page and the token back to the engine.

describe('login/+page.server.ts captcha challenge', () => {
	beforeEach(() => {
		resetRateLimitStore();
	});

	function submit(fields: Record<string, string>, fetch: typeof globalThis.fetch) {
		const formData = new FormData();
		for (const [k, v] of Object.entries(fields)) formData.set(k, v);
		return actions.default(
			mockEvent({
				request: { formData: () => Promise.resolve(formData) } as never,
				fetch,
				cookies: mockCookies(),
			}) as never
		);
	}

	it('hands the challenge to the page when the password was wrong and the threshold is crossed', async () => {
		const fetch = vi.fn(async () =>
			json(
				{ error: 'invalid credentials', captcha_required: true, captcha_site_key: '0x4AAA', captcha_provider: 'turnstile' },
				401
			)
		) as unknown as typeof globalThis.fetch;

		const result = (await submit({ email: 'a@b.co', password: 'wrong' }, fetch)) as {
			status: number;
			data: Record<string, unknown>;
		};

		expect(result.status).toBe(401);
		expect(result.data.captcha).toEqual({ provider: 'turnstile', siteKey: '0x4AAA' });
		expect(result.data.email).toBe('a@b.co');
		expect(result.data.error).toMatch(/security check/i);
		expect(result.data).not.toHaveProperty('password');
	});

	it('asks for the check when the engine refuses an attempt that carries no token', async () => {
		const fetch = vi.fn(async () =>
			json(
				{ code: 'captcha_verification_failed', captcha_required: true, captcha_site_key: 'hk-1', captcha_provider: 'hcaptcha' },
				400
			)
		) as unknown as typeof globalThis.fetch;

		const result = (await submit({ email: 'a@b.co', password: 'right' }, fetch)) as {
			status: number;
			data: Record<string, unknown>;
		};

		expect(result.status).toBe(400);
		expect(result.data.captcha).toEqual({ provider: 'hcaptcha', siteKey: 'hk-1' });
		expect(result.data.error).toBe('Complete the security check to sign in.');
	});

	it('posts the token the widget issued beside the credentials', async () => {
		const fetch = vi.fn(async (_url: string, _init: RequestInit) =>
			json({ user: { id: 'u1' }, token: 'session' })
		) as unknown as typeof globalThis.fetch;

		const r = await catchRedirect(() =>
			submit({ email: 'a@b.co', password: 'right', captcha_token: 'widget-token' }, fetch)
		);

		expect(r.location).toBe('/admin');
		const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
		expect(String(url)).toContain('/api/admin/auth/login');
		expect(JSON.parse(String(init.body))).toEqual({
			email: 'a@b.co',
			password: 'right',
			captcha_token: 'widget-token',
		});
	});

	it('sends no token field on an attempt the engine has not challenged', async () => {
		const fetch = vi.fn(async (_url: string, _init: RequestInit) =>
			json({ user: { id: 'u1' }, token: 'session' })
		) as unknown as typeof globalThis.fetch;

		await catchRedirect(() => submit({ email: 'a@b.co', password: 'right' }, fetch));

		const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
		expect(JSON.parse(String(init.body))).toEqual({ email: 'a@b.co', password: 'right' });
	});

	it('still reads a plain 401 as a rejected credential', async () => {
		const fetch = vi.fn(async () => json({ error: 'invalid credentials' }, 401)) as unknown as typeof globalThis.fetch;

		const result = await submit({ email: 'a@b.co', password: 'wrong' }, fetch);

		expect(result).toEqual({ error: 'Invalid email or password.' });
	});
});
