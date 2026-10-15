import { describe, expect, it, vi } from 'vitest';
import { createClient } from '@lyeve-labs/client';
import { getProvisioning, tenantRefusal, TENANTS_CAP } from './tenants';

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
		expect(await getProvisioning(on.client)).toEqual({ enabled: true, upgradeUrl: '' });
		expect(on.calls[0]).toContain('/api/admin/tenants/provisioning');
		expect(await getProvisioning(clientFor({ enabled: false }).client)).toEqual({ enabled: false, upgradeUrl: '' });
	});

	it('reads anything but a true as not enabled', async () => {
		expect((await getProvisioning(clientFor({}).client)).enabled).toBe(false);
		expect((await getProvisioning(clientFor({ enabled: 'yes' }).client)).enabled).toBe(false);
	});

	it('carries the link a read that says no names', async () => {
		const link = 'https://shop.example.com/pricing?skus=example-pro&utm_campaign=example';
		expect(await getProvisioning(clientFor({ enabled: false, upgrade_url: link }).client)).toEqual({
			enabled: false,
			upgradeUrl: link,
		});
	});

	it('drops a link that is not safe to put in an href', async () => {
		const read = await getProvisioning(clientFor({ enabled: false, upgrade_url: 'javascript:alert(1)' }).client);
		expect(read.upgradeUrl).toBe('');
	});

	it('throws on a missing route, which the load reads as not enabled', async () => {
		await expect(getProvisioning(clientFor({ error: 'not found' }, 404).client)).rejects.toThrow();
	});
});

/** The error a refused create throws, as the client raises it. */
async function refusedWith(body: unknown, status = 402): Promise<unknown> {
	const { client } = clientFor(body, status);
	return client.post('/api/admin/tenants', {}).then(
		() => null,
		(err: unknown) => err,
	);
}

describe('tenantRefusal', () => {
	const link = 'https://shop.example.com/pricing?plan=larger&utm_campaign=tenants';

	it('reads a missing capability as a feature this license lacks, with its link', async () => {
		const err = await refusedWith({
			error: 'payment_required',
			plugin: 'example',
			feature: 'feature:example_feature',
			upgrade_url: link,
		});
		expect(tenantRefusal(err)).toEqual({ kind: 'feature', feature: 'example-feature', plugin: 'example', upgradeUrl: link });
	});

	it('reads the ceiling sentence as a limit reached, never as a capability missing', async () => {
		const err = await refusedWith({ error: 'tenant quota reached (1); upgrade your plan to add more tenants', upgrade_url: link });
		expect(tenantRefusal(err)).toEqual({ kind: 'cap', cap: TENANTS_CAP, limit: null, current: null, upgradeUrl: link });
	});

	it('keeps a ceiling sentence with no link as a limit reached', async () => {
		const err = await refusedWith({ error: 'tenant quota reached (1); upgrade your plan to add more tenants', upgrade_url: '' });
		expect(tenantRefusal(err)).toMatchObject({ kind: 'cap', cap: TENANTS_CAP, upgradeUrl: '' });
	});

	it('passes a cap_exceeded body through with its numbers', async () => {
		const err = await refusedWith({ error: 'cap_exceeded', cap: 'example.items', limit: 2, current: 2, upgrade_url: '' });
		expect(tenantRefusal(err)).toEqual({ kind: 'cap', cap: 'example.items', limit: 2, current: 2, upgradeUrl: '' });
	});

	it('answers null for anything but a 402', async () => {
		expect(tenantRefusal(await refusedWith({ error: 'tenant slug already exists' }, 409))).toBeNull();
		expect(tenantRefusal(new Error('network'))).toBeNull();
	});
});
