import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/authz', () => ({
	authedClient: vi.fn(() => ({})),
	requireRole: vi.fn(async () => ({})),
}));

const api = vi.hoisted(() => ({
	listJobs: vi.fn(),
	listSchedules: vi.fn(),
	getSchemas: vi.fn(),
}));

vi.mock('@lyeve-labs/client-rest', () => ({ getSchemas: api.getSchemas }));
vi.mock('$lib/api/data-export', async (importOriginal) => ({
	...((await importOriginal()) as object),
	listJobs: api.listJobs,
	listSchedules: api.listSchedules,
}));

import { load } from './+page.server';

function event(query = '') {
	return {
		depends: vi.fn(),
		parent: async () => ({ plugins: null }),
		url: new URL(`http://admin.test/admin/data-export${query}`),
	} as never;
}

type Loaded = {
	schedules: { ok: boolean; value?: unknown[]; gate?: { state: string } };
	schemas: { ok: boolean; value?: string[] };
	gate: { state: string };
};

beforeEach(() => {
	vi.clearAllMocks();
	api.listJobs.mockResolvedValue({ data: [], total_count: 0 });
	api.listSchedules.mockResolvedValue({ data: [], total_count: 0 });
	api.getSchemas.mockResolvedValue([{ name: 'page' }, { name: 'article' }]);
});

describe('data export load', () => {
	it('keeps a failed schedule read as a failure, not as no schedules', async () => {
		api.listSchedules.mockRejectedValue(new Error('boom'));

		const result = (await load(event())) as unknown as Loaded;

		expect(result.gate.state).toBe('ok');
		expect(result.schedules.ok).toBe(false);
		expect(result.schedules.gate?.state).toBe('error');
	});

	it('keeps a failed schema read as a failure, not as a tenant with no schemas', async () => {
		api.getSchemas.mockRejectedValue(new Error('boom'));

		const result = (await load(event())) as unknown as Loaded;

		expect(result.schemas.ok).toBe(false);
	});

	it('hands over the lists a read answered with', async () => {
		const result = (await load(event())) as unknown as Loaded;

		expect(result.schedules).toEqual({ ok: true, value: [] });
		expect(result.schemas).toEqual({ ok: true, value: ['article', 'page'] });
	});

	it('sends a page past the end back to the last page', async () => {
		api.listJobs.mockResolvedValue({ data: [], total_count: 60 });

		await expect(load(event('?offset=200'))).rejects.toMatchObject({
			status: 307,
			location: '/admin/data-export?offset=50',
		});
	});
});
