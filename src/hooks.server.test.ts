import { afterEach, describe, it, expect, vi } from 'vitest';

// Mutable reference so individual tests can toggle dev mode.
// vi.mock is hoisted above imports, so the handle import picks up
// whatever value env.dev has at the moment it's called.
const env = vi.hoisted(() => ({ dev: true, building: false }));

vi.mock('$app/environment', () => env);

import { handle, init } from './hooks.server';
import { resetSetupGateCache } from '$lib/server/setup-gate';
import { authedHeaders } from '$lib/server/authz';
import { actions as magicLink } from './routes/auth/magic-link/verify/+page.server';
// SvelteKit's own request cookie jar, so a cookie set in handle is read back
// the way a load reads it.
// @ts-expect-error SvelteKit ships this module without type declarations.
import { add_cookies_to_headers, get_cookies } from '../node_modules/@sveltejs/kit/src/runtime/server/cookie.js';

// helpers

/** Stub resolve that just returns the given response. */
function stubResolve(response: Response = new Response('ok')) {
	return vi.fn(async (_event: unknown) => response);
}

/** Minimal event stub: handle only reads headers from event for handleFetch. */
function engineAnswering(body: unknown) {
	return vi.fn(async (): Promise<Response> =>
		new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }),
	);
}

function stubEvent(path = '/', fetch = engineAnswering({ setup_required: false }), session?: string) {
	return {
		fetch,
		url: new URL(`http://localhost${path}`),
		request: new Request('http://localhost/'),
		cookies: { get: (name: string) => (name === 'sys_session' ? session : undefined), set: () => {} } as never,
		locals: {},
		params: {},
		route: { id: null },
		isDataRequest: false,
		isSubRequest: false,
	};
}

// tests

describe('every response', () => {
	// A response passed through from fetch has immutable headers. Setting the
	// security headers on one throws.
	it('sets its headers on a response whose own headers are immutable', async () => {
		const resolve = stubResolve(Response.redirect('http://localhost/elsewhere', 302));
		const response = await handle({ event: stubEvent() as never, resolve });
		expect(response.status).toBe(302);
		expect(response.headers.get('location')).toBe('http://localhost/elsewhere');
		expect(response.headers.get('x-frame-options')).toBe('DENY');
	});

	it('sets X-Frame-Options to DENY', async () => {
		const resolve = stubResolve();
		const response = await handle({ event: stubEvent() as never, resolve });
		expect(response.headers.get('X-Frame-Options')).toBe('DENY');
	});

	it('sets X-Content-Type-Options to nosniff', async () => {
		const resolve = stubResolve();
		const response = await handle({ event: stubEvent() as never, resolve });
		expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
	});

	it('sets Referrer-Policy to strict-origin-when-cross-origin', async () => {
		const resolve = stubResolve();
		const response = await handle({ event: stubEvent() as never, resolve });
		expect(response.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
	});

	it('tells crawlers to keep out of every response', async () => {
		// Every screen is behind a session. A crawler that reaches the login
		// is told so here rather than left to guess from a 401.
		const resolve = stubResolve();
		const response = await handle({ event: stubEvent() as never, resolve });
		expect(response.headers.get('X-Robots-Tag')).toBe('noindex, nofollow, noarchive');
	});

	it('sets Permissions-Policy to deny camera, microphone, and geolocation', async () => {
		const resolve = stubResolve();
		const response = await handle({ event: stubEvent() as never, resolve });
		expect(response.headers.get('Permissions-Policy')).toBe(
			'camera=(), microphone=(), geolocation=()'
		);
	});

	it('sets Cross-Origin-Opener-Policy to same-origin', async () => {
		const resolve = stubResolve();
		const response = await handle({ event: stubEvent() as never, resolve });
		expect(response.headers.get('Cross-Origin-Opener-Policy')).toBe('same-origin');
	});

	it('applies all 5 static security headers on the resolved response', async () => {
		const resolve = stubResolve();
		const response = await handle({ event: stubEvent() as never, resolve });

		expect(response.headers.get('X-Frame-Options')).toBe('DENY');
		expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
		expect(response.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
		expect(response.headers.get('Permissions-Policy')).toBe('camera=(), microphone=(), geolocation=()');
		expect(response.headers.get('Cross-Origin-Opener-Policy')).toBe('same-origin');
	});

	it('serves the page the route renders', async () => {
		const event = stubEvent();
		const resolve = stubResolve();
		const response = await handle({ event: event as never, resolve });
		expect(resolve).toHaveBeenCalledWith(event);
		expect(response).toBeInstanceOf(Response);
	});

	describe('Strict-Transport-Security', () => {
		it('is NOT set in dev mode (http://localhost)', async () => {
			env.dev = true;
			const resolve = stubResolve();
			const response = await handle({ event: stubEvent() as never, resolve });
			expect(response.headers.get('Strict-Transport-Security')).toBeNull();
		});

		it('is set in production with max-age, includeSubDomains, and preload', async () => {
			env.dev = false;
			const resolve = stubResolve();
			const response = await handle({ event: stubEvent() as never, resolve });
			expect(response.headers.get('Strict-Transport-Security')).toBe(
				'max-age=63072000; includeSubDomains; preload'
			);
		});
	});
});

describe('starting the server', () => {
	afterEach(() => {
		env.dev = true;
		vi.unstubAllEnvs();
	});

	// adapter-node serves plain http, so an https ORIGIN has a proxy in front,
	// and without the header every visitor would share the proxy's address.
	it('refuses an https ORIGIN that leaves ADDRESS_HEADER unset', () => {
		env.dev = false;
		vi.stubEnv('CORE_API_INTERNAL_URL', 'http://engine-proxy:8080');
		vi.stubEnv('ORIGIN', 'https://console.example.com');
		vi.stubEnv('ADDRESS_HEADER', '');
		expect(() => init()).toThrow(/ADDRESS_HEADER/);
		vi.stubEnv('ADDRESS_HEADER', 'x-forwarded-for');
		expect(() => init()).not.toThrow();
	});
});

describe('the setup gate on a page request', () => {
	it('sends a page to the setup screen while the engine is in setup mode', async () => {
		resetSetupGateCache();
		const resolve = stubResolve();
		const event = stubEvent('/admin/schema', engineAnswering({ setup_required: true, mode: 'setup' }));
		await expect(handle({ event: event as never, resolve })).rejects.toMatchObject({
			status: 303,
			location: '/setup?next=%2Fadmin%2Fschema',
		});
		expect(resolve).not.toHaveBeenCalled();
	});

	it('sends a page to the setup screen while the engine cannot be reached', async () => {
		resetSetupGateCache();
		const down = vi.fn(async (): Promise<Response> => {
			throw new Error('ECONNREFUSED');
		});
		const resolve = stubResolve();
		await expect(handle({ event: stubEvent('/login', down) as never, resolve })).rejects.toMatchObject({
			location: '/setup?next=%2Flogin',
		});
	});

	it('lets a signed-in page through while the engine cannot be reached, so the outage page shows', async () => {
		resetSetupGateCache();
		const down = vi.fn(async (): Promise<Response> => {
			throw new Error('ECONNREFUSED');
		});
		const resolve = stubResolve();
		await handle({ event: stubEvent('/admin/schema', down, 'tok') as never, resolve });
		expect(resolve).toHaveBeenCalled();
	});

	it('still sends a signed-in page to the setup screen while the engine is in setup mode', async () => {
		resetSetupGateCache();
		const resolve = stubResolve();
		const event = stubEvent('/admin/schema', engineAnswering({ setup_required: true, mode: 'setup' }), 'tok');
		await expect(handle({ event: event as never, resolve })).rejects.toMatchObject({ status: 303 });
		expect(resolve).not.toHaveBeenCalled();
	});

	it('serves the setup screen itself whatever the engine says', async () => {
		resetSetupGateCache();
		const resolve = stubResolve();
		const event = stubEvent('/setup', engineAnswering({ setup_required: true, mode: 'setup' }));
		const response = await handle({ event: event as never, resolve });
		expect(resolve).toHaveBeenCalled();
		expect(response.headers.get('X-Frame-Options')).toBe('DENY');
	});
});

describe('a session close to expiry is renewed before the page loads', () => {
	it('renews a session close to expiry before any load reads it', async () => {
		resetSetupGateCache();
		const part = (v: object) => Buffer.from(JSON.stringify(v)).toString('base64url');
		const now = Math.floor(Date.now() / 1000);
		const old = `${part({ alg: 'HS256' })}.${part({ sub: 'u', exp: now + 30 })}.s`;
		const renewed = `${part({ alg: 'HS256' })}.${part({ sub: 'u', exp: now + 900 })}.s`;
		const refresh = `00000000-0000-4000-8000-000000000001.${'A'.repeat(43)}`;
		const fetch = vi.fn(async (url: string): Promise<Response> => {
			const body = url.endsWith('/auth/refresh')
				? { token: renewed, refresh_token: 'refresh-2' }
				: { setup_required: false };
			return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
		});
		const url = new URL('https://admin.example.com/admin/users');
		const request = new Request(url, {
			headers: { cookie: `__Host-sys_session=${old}; __Host-console_refresh=${refresh}` },
		});
		const jar = get_cookies(request, url);
		jar.set_trailing_slash('never');
		const event = { ...stubEvent('/admin/users', fetch as never), url, request, cookies: jar.cookies, getClientAddress: () => '203.0.113.7' };

		let seen = '';
		const resolve = vi.fn(async (e: unknown) => {
			seen = authedHeaders(e as never).Authorization;
			return new Response('ok');
		});
		await handle({ event: event as never, resolve });

		expect(fetch).toHaveBeenCalledWith('/api/admin/auth/refresh', expect.anything());
		expect(seen).toBe(`Bearer ${renewed}`);
	});
});

/** The cookies SvelteKit has set during a request, as one Set-Cookie line each. */
interface Jar {
	cookies: unknown;
	new_cookies: Map<string, { name: string; value: string; options: { maxAge?: number } }>;
	get_cookie_header(destination: URL, header: string | null): string;
	set_trailing_slash(mode: string): void;
}

function setCookieLines(jar: Jar): string[] {
	const headers = new Headers();
	add_cookies_to_headers(headers, jar.new_cookies.values());
	return headers.getSetCookie();
}

/**
 * The engine's double-submit check on a write, as its CSRF middleware reads
 * it: with a session cookie present, the CSRF cookie (prefixed name first) and
 * the X-CSRF-Token header are both set and equal.
 */
function engineAcceptsWrite(cookieHeader: string, headers: Record<string, string>): boolean {
	const sent = new Map(
		cookieHeader
			.split(';')
			.map((pair) => pair.trim().split('='))
			.filter(([name]) => name)
			.map(([name, ...value]) => [name, value.join('=')])
	);
	if (!sent.get('__Host-sys_session') && !sent.get('sys_session')) return true;
	const cookie = sent.get('__Host-csrf') || sent.get('csrf');
	const header = headers['X-CSRF-Token']?.trim();
	return !!cookie && !!header && cookie === header;
}

/**
 * One console request through handle whose load sends a write to the engine.
 * Returns what the engine would read: the cookie header SvelteKit forwards on
 * a same-origin call, and the headers the console sets.
 */
async function consoleWrite(url: URL, cookieHeader: string) {
	resetSetupGateCache();
	const jar = get_cookies(new Request(url, { headers: { cookie: cookieHeader } }), url) as Jar;
	jar.set_trailing_slash('never');
	const event = { ...stubEvent(url.pathname), url, request: new Request(url), cookies: jar.cookies, getClientAddress: () => '203.0.113.7' };
	let sent = { cookie: '', headers: {} as Record<string, string> };
	const resolve = vi.fn(async (e: unknown) => {
		const write = new URL('/api/admin/schemas/posts', url);
		sent = { cookie: jar.get_cookie_header(write, null), headers: authedHeaders(e as never) };
		return new Response('ok');
	});
	await handle({ event: event as never, resolve });
	return { ...sent, setCookie: setCookieLines(jar) };
}

const part = (v: object) => Buffer.from(JSON.stringify(v)).toString('base64url');
const sessionJwt = () => `${part({ alg: 'HS256' })}.${part({ sub: 'u', exp: Math.floor(Date.now() / 1000) + 900 })}.s`;

describe('a session the engine opened without a CSRF cookie', () => {
	it('can write after a sign-in by emailed link', async () => {
		// The sign-in itself, through the console's own action and cookie jar.
		const signInUrl = new URL('http://localhost/auth/magic-link/verify');
		const signIn = get_cookies(new Request(signInUrl), signInUrl) as Jar;
		signIn.set_trailing_slash('never');
		const form = new FormData();
		form.set('token', 'link-token');
		const engine = vi.fn(async () =>
			new Response(JSON.stringify({ access_token: sessionJwt(), user_id: 'u1', email: 'a@b.co' }), {
				status: 200,
				headers: { 'content-type': 'application/json' },
			})
		);
		await expect(
			magicLink.verify({
				url: signInUrl,
				cookies: signIn.cookies,
				fetch: engine,
				request: { formData: () => Promise.resolve(form) },
				getClientAddress: () => '203.0.113.7',
			} as never)
		).rejects.toMatchObject({ status: 303 });

		// The browser's next request carries what the sign-in left it.
		const kept = [...signIn.new_cookies.values()].filter((c) => c.options.maxAge !== 0);
		expect(kept.map((c) => c.name)).toEqual(['sys_session']);
		const browser = kept.map((c) => `${c.name}=${c.value}`).join('; ');

		const sent = await consoleWrite(new URL('http://localhost/admin/schema'), browser);

		expect(sent.headers['X-CSRF-Token']).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(engineAcceptsWrite(sent.cookie, sent.headers)).toBe(true);
		// The browser keeps the token for its own writes, readable by the page.
		expect(sent.setCookie).toEqual([
			`csrf=${sent.headers['X-CSRF-Token']}; Max-Age=86400; Path=/; SameSite=Strict`,
		]);
	});

	it('can write after an OAuth or SAML sign-in, which sets only the session cookie', async () => {
		const sent = await consoleWrite(new URL('https://admin.example.com/admin'), `__Host-sys_session=${sessionJwt()}`);

		expect(engineAcceptsWrite(sent.cookie, sent.headers)).toBe(true);
		expect(sent.setCookie).toEqual([
			`__Host-csrf=${sent.headers['X-CSRF-Token']}; Max-Age=86400; Path=/; Secure; SameSite=Strict`,
		]);
	});

	it('keeps the CSRF cookie the engine set', async () => {
		const sent = await consoleWrite(
			new URL('https://admin.example.com/admin'),
			`__Host-sys_session=${sessionJwt()}; __Host-csrf=engine-token`
		);

		expect(sent.headers['X-CSRF-Token']).toBe('engine-token');
		expect(engineAcceptsWrite(sent.cookie, sent.headers)).toBe(true);
		expect(sent.setCookie).toEqual([]);
	});

	it('sets no CSRF cookie without a session', async () => {
		resetSetupGateCache();
		const url = new URL('https://admin.example.com/login');
		const jar = get_cookies(new Request(url), url) as Jar;
		jar.set_trailing_slash('never');
		const event = { ...stubEvent('/login'), url, cookies: jar.cookies };
		await handle({ event: event as never, resolve: stubResolve() });
		expect(setCookieLines(jar)).toEqual([]);
	});

	it('mints a different token for each session', async () => {
		const url = new URL('https://admin.example.com/admin');
		const one = await consoleWrite(url, `__Host-sys_session=${sessionJwt()}`);
		const two = await consoleWrite(url, `__Host-sys_session=${sessionJwt()}`);
		expect(one.headers['X-CSRF-Token']).not.toBe(two.headers['X-CSRF-Token']);
	});
});
