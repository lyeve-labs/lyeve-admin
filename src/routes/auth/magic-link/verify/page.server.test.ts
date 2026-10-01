import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Cookies } from '@sveltejs/kit';
import { actions, load } from './+page.server';
import { resetRateLimitStore } from '$lib/server/rate-limit';

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function mockCookies(): Cookies {
	return { set: vi.fn(), get: vi.fn(), delete: vi.fn(), getAll: vi.fn(() => []), serialize: vi.fn() } as unknown as Cookies;
}

function event(fields: Record<string, string>, fetch: typeof globalThis.fetch, cookies = mockCookies()) {
	const formData = new FormData();
	for (const [k, v] of Object.entries(fields)) formData.set(k, v);
	return {
		getClientAddress: () => '127.0.0.1',
		request: { formData: () => Promise.resolve(formData) },
		fetch,
		cookies,
	} as never;
}

async function redirectOf(p: Promise<unknown>): Promise<{ status: number; location: string }> {
	try {
		await p;
	} catch (e) {
		const r = e as { status?: number; location?: string };
		if (r.status && r.location) return { status: r.status, location: r.location };
		throw e;
	}
	throw new Error('expected a redirect');
}

describe('auth/magic-link/verify load', () => {
	it('reads the token without redeeming it', () => {
		const data = load({ url: new URL('http://admin.test/auth/magic-link/verify?token=abc') } as never);
		expect(data).toEqual({ token: 'abc' });
	});
});

describe('auth/magic-link/verify actions', () => {
	beforeEach(() => resetRateLimitStore());

	it('redeems the token, sets the session and opens the console', async () => {
		const fetch = vi.fn(async (_url: string, _init: RequestInit) =>
			json({ access_token: 'sess', is_new_user: false, user_id: 'u1', email: 'a@b.co' })
		) as unknown as typeof globalThis.fetch;
		const cookies = mockCookies();

		const r = await redirectOf(Promise.resolve(actions.verify(event({ token: 'abc' }, fetch, cookies))));

		expect(r).toEqual({ status: 303, location: '/admin' });
		expect(cookies.set).toHaveBeenCalledWith('__Host-sys_session', 'sess', expect.objectContaining({ httpOnly: true }));
		const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
		expect(String(url)).toContain('/api/admin/auth/magic-link/verify');
		expect(JSON.parse(String(init.body))).toEqual({ token: 'abc' });
	});

	it('moves to the second factor when the account has one', async () => {
		const fetch = vi.fn(async () =>
			json({ mfa_required: true, challenge_token: 'ch', mfa_methods: ['totp'] })
		) as unknown as typeof globalThis.fetch;
		const cookies = mockCookies();

		const result = await actions.verify(event({ token: 'abc' }, fetch, cookies));

		expect(result).toEqual({ mfa_required: true, challenge_token: 'ch' });
		expect(cookies.set).not.toHaveBeenCalled();
	});

	it('reads a refused token as an expired link', async () => {
		const fetch = vi.fn(async () => json({ error: 'invalid or expired magic link' }, 400)) as unknown as typeof globalThis.fetch;
		const result = (await actions.verify(event({ token: 'spent' }, fetch))) as { status: number; data: { error: string } };
		expect(result.status).toBe(400);
		expect(result.data.error).toMatch(/invalid or has expired/);
	});

	it('finishes the second factor and opens the console', async () => {
		const fetch = vi.fn(async (_url: string, _init: RequestInit) => json({ token: 'sess2', user: { id: 'u1' } })) as unknown as typeof globalThis.fetch;
		const cookies = mockCookies();

		const r = await redirectOf(Promise.resolve(actions.mfa(event({ challenge_token: 'ch', code: '123456' }, fetch, cookies))));

		expect(r.location).toBe('/admin');
		expect(cookies.set).toHaveBeenCalledWith('__Host-sys_session', 'sess2', expect.anything());
		const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
		expect(String(url)).toContain('/api/admin/auth/mfa-verify');
		expect(JSON.parse(String(init.body))).toEqual({ challenge_token: 'ch', code: '123456' });
	});

	it('keeps the challenge on a wrong code', async () => {
		const fetch = vi.fn(async () => json({ error: 'invalid code' }, 401)) as unknown as typeof globalThis.fetch;
		const result = (await actions.mfa(event({ challenge_token: 'ch', code: '000000' }, fetch))) as {
			data: Record<string, unknown>;
		};
		expect(result.data).toEqual({ error: 'Invalid code.', mfa_required: true, challenge_token: 'ch' });
	});
});
