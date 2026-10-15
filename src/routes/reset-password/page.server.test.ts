import { beforeEach, describe, expect, it, vi } from 'vitest';
import { actions, load } from './+page.server';
import { resetRateLimitStore } from '$lib/server/rate-limit';

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function submit(fields: Record<string, string>, fetch: typeof globalThis.fetch) {
	const formData = new FormData();
	for (const [k, v] of Object.entries(fields)) formData.set(k, v);
	return actions.default({
		getClientAddress: () => '127.0.0.1',
		request: { formData: () => Promise.resolve(formData) },
		fetch,
	} as never);
}

const STRONG = 'correct horse battery';

describe('reset-password load', () => {
	it('reads the token from the link', () => {
		expect(load({ url: new URL('http://admin.test/reset-password?token=t1') } as never)).toEqual({
			token: 't1',
			minLength: 12,
			carried: '',
		});
	});

	it('carries the organization its link names, and drops one the engine would not read', () => {
		const named = load({ url: new URL('http://admin.test/reset-password?token=t1&tenant=acme') } as never) as { carried: string };
		expect(named.carried).toBe('acme');
		const malformed = load({ url: new URL('http://admin.test/reset-password?token=t1&tenant=Acme%20Co') } as never) as {
			carried: string;
		};
		expect(malformed.carried).toBe('');
	});
});

describe('reset-password action', () => {
	// An outage says nothing about what the visitor typed, so it reads as the
	// engine being away rather than as a bad address or an expired link.
	it.each([
		['answers 503', () => json({ error: 'dial tcp 10.0.0.4:5432: connection refused' }, 503)],
		['answers 502', () => json({ error: 'bad gateway' }, 502)],
		['does not answer', () => Promise.reject(new TypeError('fetch failed'))],
	])('says the engine is unavailable when it %s', async (_case, answer) => {
		const fetch = vi.fn(async () => answer()) as unknown as typeof globalThis.fetch;
		const result = (await submit({ token: 't1', password: STRONG, confirm: STRONG }, fetch)) as { status: number; data: { error: string } };
		expect(result.status).toBeGreaterThanOrEqual(500);
		expect(result.data.error).toBe('Password reset is unavailable right now. Please try again shortly.');
	});

	beforeEach(() => resetRateLimitStore());

	it('sets the new password with the token from the link', async () => {
		const fetch = vi.fn(async (_url: string, _init: RequestInit) =>
			json({ message: 'Password has been reset successfully.' })
		) as unknown as typeof globalThis.fetch;

		const result = await submit({ token: 't1', password: STRONG, confirm: STRONG }, fetch);

		expect(result).toEqual({ done: true });
		const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
		expect(String(url)).toContain('/api/admin/auth/password-reset/confirm');
		expect(JSON.parse(String(init.body))).toEqual({ token: 't1', password: STRONG });
	});

	it('refuses a short password before spending the token', async () => {
		const fetch = vi.fn() as unknown as typeof globalThis.fetch;
		const result = (await submit({ token: 't1', password: 'short', confirm: 'short' }, fetch)) as {
			data: { error: string };
		};
		expect(result.data.error).toBe('Use at least 12 characters.');
		expect(fetch).not.toHaveBeenCalled();
	});

	it('refuses a password over 72 bytes before spending the token', async () => {
		const fetch = vi.fn() as unknown as typeof globalThis.fetch;
		// 37 characters, 74 bytes in UTF-8.
		const long = 'é'.repeat(37);
		const result = (await submit({ token: 't1', password: long, confirm: long }, fetch)) as {
			data: { error: string };
		};
		expect(result.data.error).toMatch(/at most 72 bytes/);
		expect(fetch).not.toHaveBeenCalled();
	});

	it('refuses two passwords that differ', async () => {
		const fetch = vi.fn() as unknown as typeof globalThis.fetch;
		const result = (await submit({ token: 't1', password: STRONG, confirm: STRONG + '!' }, fetch)) as {
			data: { error: string };
		};
		expect(result.data.error).toBe('The two passwords do not match.');
		expect(fetch).not.toHaveBeenCalled();
	});

	it('reads a refused token as an expired link', async () => {
		const fetch = vi.fn(async () => json({ error: 'invalid or expired reset token' }, 400)) as unknown as typeof globalThis.fetch;
		const result = (await submit({ token: 'spent', password: STRONG, confirm: STRONG }, fetch)) as {
			status: number;
			data: Record<string, unknown>;
		};
		expect(result.status).toBe(400);
		expect(result.data.expired).toBe(true);
	});
});
