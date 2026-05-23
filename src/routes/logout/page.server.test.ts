import { describe, it, expect, vi } from 'vitest';
import type { Cookies } from '@sveltejs/kit';
import { actions } from './+page.server';

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

// tests

describe('logout/+page.server.ts actions.default', () => {
	it('deletes the session cookie and redirects to /login when logged in', async () => {
		const fetch = vi.fn(async (_url: string, _init: RequestInit) =>
			json({}, 204)
		) as unknown as typeof globalThis.fetch;
		const cookies = mockCookies({ '__Host-sys_session': 'session-token' });

		const r = await catchRedirect(() =>
			actions.default({ fetch, cookies } as never)
		);

		// Cleared with the attributes it was set with. Without Secure the browser
		// discards the deletion and the operator stays signed in after clicking
		// sign out.
		expect(cookies.delete).toHaveBeenCalledWith('__Host-sys_session', {
			path: '/',
			httpOnly: true,
			secure: true,
			sameSite: 'strict',
		});
		expect(r.status).toBe(302);
		expect(r.location).toBe('/login');
	});

	it('still deletes cookie and redirects even when the logout API call fails', async () => {
		// logout is best-effort. Cookie is always cleared regardless of API success.
		const fetch = vi.fn(async (_url: string, _init: RequestInit) => {
			throw new Error('server unreachable');
		}) as unknown as typeof globalThis.fetch;
		const cookies = mockCookies({ '__Host-sys_session': 'session-token' });

		const r = await catchRedirect(() =>
			actions.default({ fetch, cookies } as never)
		);

		// Cleared with the attributes it was set with. Without Secure the browser
		// discards the deletion and the operator stays signed in after clicking
		// sign out.
		expect(cookies.delete).toHaveBeenCalledWith('__Host-sys_session', {
			path: '/',
			httpOnly: true,
			secure: true,
			sameSite: 'strict',
		});
		expect(r.status).toBe(302);
		expect(r.location).toBe('/login');
	});

	it('redirects to /login even when there is no session cookie (no-op logout)', async () => {
		const fetch = vi.fn() as unknown as typeof globalThis.fetch;
		const cookies = mockCookies(); // no cookie

		const r = await catchRedirect(() =>
			actions.default({ fetch, cookies } as never)
		);

		// Should not call fetch (no token to revoke), but still redirect
		expect(r.status).toBe(302);
		expect(r.location).toBe('/login');
	});

	it('passes the Bearer token to the logout API call', async () => {
		const fetch = vi.fn(async (_url: string, _init: RequestInit) =>
			json({}, 204)
		) as unknown as typeof globalThis.fetch;
		const cookies = mockCookies({ '__Host-sys_session': 'my-token' });

		await catchRedirect(() =>
			actions.default({ fetch, cookies } as never)
		);

		// Verify the fetch was called with the Authorization header
		expect(fetch).toHaveBeenCalled();
		const callArgs = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
		const init = callArgs[1] as RequestInit;
		expect((init.headers as Record<string, string>).Authorization).toBe('Bearer my-token');
	});
});
