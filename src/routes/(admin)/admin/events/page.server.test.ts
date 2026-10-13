import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@lyeve-labs/client';

const engine = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock('$lib/server/authz', async (importOriginal) => ({
	...((await importOriginal()) as object),
	authedClient: vi.fn(() => engine),
	requireRole: vi.fn(async () => ({ id: 'u1', roles: ['admin'] })),
}));

import { load } from './+page.server';

type Loaded = Exclude<Awaited<ReturnType<typeof load>>, void>;

function loadEvent(query = '') {
	return {
		url: new URL(`http://localhost/admin/events${query}`),
		parent: async () => ({ plugins: { state: 'named', running: ['events'], withheld: [] } }),
	} as never;
}

function route(map: Record<string, unknown>) {
	engine.get.mockImplementation(async (url: string) => {
		for (const [needle, body] of Object.entries(map)) {
			if (url.includes(needle)) {
				if (body instanceof Error) throw body;
				return body;
			}
		}
		throw new ApiError(404, 'not found', {});
	});
}

beforeEach(() => vi.clearAllMocks());

describe('the events load', () => {
	it('keeps a failed run list as a gate rather than no runs', async () => {
		route({ '/events/replay': new ApiError(503, 'down', {}), '/events?': { data: [], total_count: 0 } });
		const out = (await load(loadEvent())) as Loaded;
		expect(out.runs).toEqual({ ok: false, gate: { state: 'unavailable' } });
	});

	it('counts every run, not the rows it asked for', async () => {
		route({ '/events/replay': { data: [{ run_id: 'r1' }], total_count: 37 }, '/events?': { data: [], total_count: 0 } });
		const out = (await load(loadEvent())) as Loaded;
		expect(out.runs).toEqual({ ok: true, value: { rows: [{ run_id: 'r1' }], total: 37 } });
	});
});
