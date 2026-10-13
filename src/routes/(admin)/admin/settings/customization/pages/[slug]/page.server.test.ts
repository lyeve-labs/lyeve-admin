import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@lyeve-labs/client';

const api = vi.hoisted(() => ({ getCustomPage: vi.fn(), saveCustomPage: vi.fn(), deleteCustomPage: vi.fn() }));
const schemas = vi.hoisted(() => vi.fn(async () => ['posts']));

vi.mock('$lib/server/authz', () => ({
	authedClient: vi.fn(() => ({})),
	requireRole: vi.fn(async () => ({ roles: ['admin'] })),
}));
vi.mock('$lib/api/search-settings', () => ({ listSchemaNames: schemas }));
vi.mock('$lib/api/customization', async (orig) => ({
	...(await orig<typeof import('$lib/api/customization')>()),
	...api,
}));

import { load } from './+page.server';

function event() {
	return {
		params: { slug: 'launch' },
		parent: async () => ({ user: { roles: ['admin'] }, customization: { entitled: true, settings: {}, pages: [] } }),
	} as never;
}

const page = { slug: 'launch', title: 'Launch', description: '', roles: [], blocks: [], position: 0 };

beforeEach(() => {
	vi.clearAllMocks();
	api.getCustomPage.mockResolvedValue(page);
});

describe('custom page editor load', () => {
	it('reads the page and the schemas', async () => {
		const data = (await load(event())) as { customPage: unknown; schemas: string[]; schemasRead: boolean };
		expect(data.customPage).toEqual(page);
		expect(data.schemas).toEqual(['posts']);
		expect(data.schemasRead).toBe(true);
	});

	// A page that exists is never reported missing because the engine or its
	// database did not answer.
	it('answers 404 only for the engine 404', async () => {
		api.getCustomPage.mockRejectedValueOnce(new ApiError(404, 'not found'));
		await expect(load(event())).rejects.toMatchObject({ status: 404, body: { message: 'No page has that address.' } });
		api.getCustomPage.mockRejectedValueOnce(new ApiError(503, 'unavailable'));
		await expect(load(event())).rejects.toMatchObject({ status: 503 });
		api.getCustomPage.mockRejectedValueOnce(new ApiError(403, 'forbidden'));
		await expect(load(event())).rejects.toMatchObject({ status: 403 });
	});

	it('says the schemas were not read rather than that there are none', async () => {
		schemas.mockRejectedValueOnce(new ApiError(503, 'unavailable'));
		const data = (await load(event())) as { schemas: string[]; schemasRead: boolean };
		expect(data.schemas).toEqual([]);
		expect(data.schemasRead).toBe(false);
	});
});
