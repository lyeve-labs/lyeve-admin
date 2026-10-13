import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/authz', () => ({
	requireRole: vi.fn(),
	authedClient: (event: { fetch: typeof fetch }) => ({
		get: async (path: string) => (await event.fetch(path)).json(),
	}),
}));

import { load } from './+page.server';

function event(body: unknown, search: string) {
	return {
		fetch: vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })),
		url: new URL(`http://admin/admin/settings/scim${search}`),
		parent: async () => ({ plugins: { state: 'named', running: ['scim'], withheld: [] } }),
	} as never;
}

describe('SCIM load', () => {
	it('sends a page past the end back to the last page that holds connections', async () => {
		await expect(load(event({ data: [], total_count: 3 }, '?offset=50&limit=25'))).rejects.toMatchObject({
			status: 307,
			location: '/admin/settings/scim?offset=0&limit=25',
		});
	});
});
