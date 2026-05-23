import { describe, expect, it, vi } from 'vitest';
import { createClient } from '@lyeve-labs/client';
import { getRoleLimits } from './permissions';

function clientFor(body: unknown, status = 200) {
	const calls: string[] = [];
	const fetch = vi.fn(async (url: string) => {
		calls.push(String(url));
		return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
	}) as unknown as typeof globalThis.fetch;
	return { client: createClient(fetch, {}), calls };
}

describe('getRoleLimits', () => {
	it('reads the ceiling and the count the plugin serves', async () => {
		const { client, calls } = clientFor({ roles: { limit: 4, current: 2 } });
		expect(await getRoleLimits(client)).toEqual({ roles: { limit: 4, current: 2 } });
		expect(calls[0]).toContain('/api/admin/permissions/limits');
	});

	it('reads a missing or malformed number as 0, which is no ceiling', async () => {
		expect(await getRoleLimits(clientFor({}).client)).toEqual({ roles: { limit: 0, current: 0 } });
		expect(await getRoleLimits(clientFor({ roles: { limit: -1, current: 'x' } }).client)).toEqual({ roles: { limit: 0, current: 0 } });
	});

	it('throws on a missing route, which the load reads as no ceiling', async () => {
		await expect(getRoleLimits(clientFor({ error: 'not found' }, 404).client)).rejects.toThrow();
	});
});
