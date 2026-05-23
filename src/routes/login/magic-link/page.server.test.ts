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

describe('login/magic-link action', () => {
	beforeEach(() => resetRateLimitStore());

	it('asks the engine for a link and reports it sent', async () => {
		const fetch = vi.fn(async (_url: string, _init: RequestInit) =>
			json({ message: 'if the email exists, a magic link has been sent' })
		) as unknown as typeof globalThis.fetch;

		const result = await submit({ email: ' a@b.co ' }, fetch);

		expect(result).toEqual({ sent: true, email: 'a@b.co' });
		const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
		expect(String(url)).toContain('/api/admin/auth/magic-link/request');
		expect(JSON.parse(String(init.body))).toEqual({ email: 'a@b.co' });
	});

	it('refuses an empty address without calling the engine', async () => {
		const fetch = vi.fn() as unknown as typeof globalThis.fetch;
		const result = (await submit({ email: '' }, fetch)) as { status: number };
		expect(result.status).toBe(400);
		expect(fetch).not.toHaveBeenCalled();
	});

	it('says the feature is off when the engine has no such route', async () => {
		const fetch = vi.fn(async () => json({ error: 'not found' }, 404)) as unknown as typeof globalThis.fetch;
		const result = (await submit({ email: 'a@b.co' }, fetch)) as { status: number; data: { error: string } };
		expect(result.status).toBe(404);
		expect(result.data.error).toMatch(/not enabled/);
	});

	it('relays the engine rate limit', async () => {
		const fetch = vi.fn(async () => json({ error: 'too many' }, 429)) as unknown as typeof globalThis.fetch;
		const result = (await submit({ email: 'a@b.co' }, fetch)) as { status: number };
		expect(result.status).toBe(429);
	});
});
