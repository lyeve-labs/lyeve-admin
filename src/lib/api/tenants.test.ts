import { describe, expect, it, vi } from 'vitest';
import { createClient } from '@lyeve-labs/client';
import { getProvisioning } from './tenants';

function clientFor(body: unknown, status = 200) {
	const calls: string[] = [];
	const fetch = vi.fn(async (url: string) => {
		calls.push(String(url));
		return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
	}) as unknown as typeof globalThis.fetch;
	return { client: createClient(fetch, {}), calls };
}

describe('getProvisioning', () => {
	it('asks the plugin and reads its answer', async () => {
		const on = clientFor({ enabled: true });
		expect(await getProvisioning(on.client)).toBe(true);
		expect(on.calls[0]).toContain('/api/admin/tenants/provisioning');
		expect(await getProvisioning(clientFor({ enabled: false }).client)).toBe(false);
	});

	it('reads anything but a true as not enabled', async () => {
		expect(await getProvisioning(clientFor({}).client)).toBe(false);
		expect(await getProvisioning(clientFor({ enabled: 'yes' }).client)).toBe(false);
	});

	it('throws on a missing route, which the load reads as not enabled', async () => {
		await expect(getProvisioning(clientFor({ error: 'not found' }, 404).client)).rejects.toThrow();
	});
});
