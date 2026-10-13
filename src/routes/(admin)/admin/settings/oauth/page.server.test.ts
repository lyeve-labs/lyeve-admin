import { describe, expect, it, vi } from 'vitest';
import type { Cookies } from '@sveltejs/kit';
import { load } from './+page.server';

const cookies = { get: () => 'tok', set: vi.fn(), delete: vi.fn(), getAll: () => [], serialize: () => '' } as unknown as Cookies;

function event(status: number, body: unknown) {
	return {
		fetch: vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })),
		cookies,
		url: new URL('http://admin/admin/settings/oauth'),
		parent: async () => ({ user: { roles: ['super_admin'] } }),
	} as never;
}

describe('OAuth providers load', () => {
	it('keeps a failed read apart from an instance with no providers', async () => {
		const out = (await load(event(500, { error: 'boom' }))) as { providers: { ok: boolean } };
		expect(out.providers.ok).toBe(false);
	});

	it('answers the providers the engine lists', async () => {
		const out = (await load(event(200, []))) as { providers: unknown };
		expect(out.providers).toEqual({ ok: true, value: [] });
	});
});
