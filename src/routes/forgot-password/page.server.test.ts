import { beforeEach, describe, expect, it, vi } from 'vitest';
import { actions } from './+page.server';
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

describe('forgot-password action', () => {
	// An outage says nothing about what the visitor typed, so it reads as the
	// engine being away rather than as a bad address or an expired link.
	it.each([
		['answers 503', () => json({ error: 'dial tcp 10.0.0.4:5432: connection refused' }, 503)],
		['answers 502', () => json({ error: 'bad gateway' }, 502)],
		['does not answer', () => Promise.reject(new TypeError('fetch failed'))],
	])('says the engine is unavailable when it %s', async (_case, answer) => {
		const fetch = vi.fn(async () => answer()) as unknown as typeof globalThis.fetch;
		const result = (await submit({ email: 'a@b.co' }, fetch)) as { status: number; data: { error: string } };
		expect(result.status).toBeGreaterThanOrEqual(500);
		expect(result.data.error).toBe('Password reset is unavailable right now. Please try again shortly.');
	});

	beforeEach(() => resetRateLimitStore());

	it('asks the engine for a reset link and reports it sent', async () => {
		const fetch = vi.fn(async (_url: string, _init: RequestInit) => json({ message: 'sent' })) as unknown as typeof globalThis.fetch;

		const result = await submit({ email: 'a@b.co' }, fetch);

		expect(result).toEqual({ sent: true, email: 'a@b.co' });
		const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
		expect(String(url)).toContain('/api/admin/auth/password-reset/request');
		expect(JSON.parse(String(init.body))).toEqual({ email: 'a@b.co' });
	});

	it('reads a malformed address the engine refused as the visitor\'s to fix', async () => {
		const fetch = vi.fn(async () => json({ error: 'validation failed' }, 400)) as unknown as typeof globalThis.fetch;
		const result = (await submit({ email: 'nope' }, fetch)) as { status: number; data: { error: string; email: string } };
		expect(result.status).toBe(400);
		expect(result.data).toEqual({ error: 'Enter a valid email address.', email: 'nope' });
	});

	it('says the feature is off when the engine has no such route', async () => {
		const fetch = vi.fn(async () => json({ error: 'not found' }, 404)) as unknown as typeof globalThis.fetch;
		const result = (await submit({ email: 'a@b.co' }, fetch)) as { status: number; data: { error: string } };
		expect(result.data.error).toBe('Password reset is not enabled on this instance. Ask an administrator to sign you in.');
	});
});
