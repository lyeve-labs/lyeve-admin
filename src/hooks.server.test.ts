import { describe, it, expect, vi } from 'vitest';

// Mutable reference so individual tests can toggle dev mode.
// vi.mock is hoisted above imports, so the handle import picks up
// whatever value env.dev has at the moment it's called.
const env = vi.hoisted(() => ({ dev: true }));

vi.mock('$app/environment', () => env);

import { handle } from './hooks.server';
import { resetSetupGateCache } from '$lib/server/setup-gate';

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

function stubEvent(path = '/', fetch = engineAnswering({ setup_required: false })) {
	return {
		fetch,
		url: new URL(`http://localhost${path}`),
		request: new Request('http://localhost/'),
		cookies: {} as never,
		locals: {},
		params: {},
		route: { id: null },
		isDataRequest: false,
		isSubRequest: false,
	};
}

// tests

describe('hooks.server.ts handle', () => {
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

	it('calls resolve(event) and returns the response', async () => {
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

describe('hooks.server.ts setup gate', () => {
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

	it('serves the setup screen itself whatever the engine says', async () => {
		resetSetupGateCache();
		const resolve = stubResolve();
		const event = stubEvent('/setup', engineAnswering({ setup_required: true, mode: 'setup' }));
		const response = await handle({ event: event as never, resolve });
		expect(resolve).toHaveBeenCalled();
		expect(response.headers.get('X-Frame-Options')).toBe('DENY');
	});
});
