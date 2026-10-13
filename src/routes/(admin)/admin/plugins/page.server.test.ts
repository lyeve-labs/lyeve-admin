import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Cookies } from '@sveltejs/kit';

const api = vi.hoisted(() => ({
	getPluginStatus: vi.fn(),
	getEntitlements: vi.fn(),
}));

vi.mock('@lyeve-labs/client', async (importOriginal) => ({
	...((await importOriginal()) as object),
	createClient: vi.fn(() => ({})),
}));
vi.mock('@lyeve-labs/client-rest', () => api);

import { load } from './+page.server';
import { ApiError } from '@lyeve-labs/client';

interface PluginsLoadResult {
	plugins: { name: string }[];
	gate: unknown;
}

async function runLoad(): Promise<PluginsLoadResult> {
	const event = {
		fetch: vi.fn() as unknown as typeof globalThis.fetch,
		cookies: { get: vi.fn(() => 'tok') } as unknown as Cookies,
		parent: async () => ({}),
	} as never;
	return (await load(event)) as unknown as PluginsLoadResult;
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('admin/plugins/+page.server.ts load', () => {
	it('reads the plugin status and nothing else', async () => {
		api.getPluginStatus.mockResolvedValue({ compiled: ['search'], entitled: [], plugins: [{ name: 'search' }] });

		const result = await runLoad();

		expect(result).toEqual({ plugins: [{ name: 'search' }], gate: { state: 'ok' } });
		expect(api.getEntitlements).not.toHaveBeenCalled();
	});

	it('reads a report with no rows as no plugins', async () => {
		api.getPluginStatus.mockResolvedValue({ compiled: [], entitled: [] });

		expect(await runLoad()).toEqual({ plugins: [], gate: { state: 'ok' } });
	});

	it('says the read failed rather than listing nothing as if the build were empty', async () => {
		api.getPluginStatus.mockRejectedValue(new Error('pq: connection refused'));

		const result = await runLoad();
		expect(result.plugins).toEqual([]);
		expect(result.gate).toEqual({ state: 'error', message: expect.stringContaining('could not be read') });
		expect(JSON.stringify(result)).not.toContain('pq:');
	});

	it('says a role refusal as one, not as an engine that did not answer', async () => {
		api.getPluginStatus.mockRejectedValue(new ApiError(403, 'forbidden', {}));

		expect((await runLoad()).gate).toEqual({ state: 'forbidden' });
	});
});
