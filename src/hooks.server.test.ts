import { describe, it, expect, vi } from 'vitest';

// Mutable reference so individual tests can toggle dev mode.
// vi.mock is hoisted above imports, so the handle import picks up
// whatever value env.dev has at the moment it's called.
const env = vi.hoisted(() => ({ dev: true }));

vi.mock('$app/environment', () => env);

import { handle } from './hooks.server';
import { resetSetupGateCache } from '$lib/server/setup-gate';
import { authedHeaders } from '$lib/server/authz';
// SvelteKit's own request cookie jar, so a cookie set in handle is read back
// the way a load reads it.
// @ts-expect-error SvelteKit ships this module without type declarations.
import { get_cookies } from '../node_modules/@sveltejs/kit/src/runtime/server/cookie.js';

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
		cookies: { get: (name: string) => (name === 'sys_session' ? session : undefined) } as never,
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
