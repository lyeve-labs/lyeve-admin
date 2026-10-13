import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/authz', () => ({
	authedClient: (event: { fetch: typeof fetch }) => ({
		get: async (path: string) => {
			const res = await event.fetch(path);
			return res.json();
		},
	}),
}));

import { load } from './+page.server';

function event(body: unknown, search: string) {
	return {
		fetch: vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })),
		url: new URL(`http://admin/admin/settings/devices${search}`),
		request: new Request('http://admin/admin/settings/devices'),
		parent: async () => ({ plugins: { state: 'named', running: ['device-fingerprint'], withheld: [] } }),
	} as never;
}

describe('devices load', () => {
	it('sends a page past the end back to the last page that holds devices', async () => {
		await expect(load(event({ data: [], total_count: 30 }, '?offset=100&limit=25'))).rejects.toMatchObject({
			status: 307,
			location: '/admin/settings/devices?offset=25&limit=25',
		});
	});

	it('stays on the first page when there is no device at all', async () => {
		const out = (await load(event({ data: [], total_count: 0 }, ''))) as { devices: unknown[] };
		expect(out.devices).toEqual([]);
	});
});
