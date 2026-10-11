import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@lyeve-labs/client';

const engine = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock('$lib/server/authz', async (importOriginal) => ({
	...((await importOriginal()) as object),
	authedClient: vi.fn(() => engine),
	requireRole: vi.fn(async () => ({ id: 'u1', roles: ['admin'] })),
}));

import { load } from './+page.server';

const ID = 'eec2c34c-da5e-47fc-a666-e8c7be1455eb';

function loadEvent() {
	return {
		params: { id: ID },
		url: new URL(`http://localhost/admin/experiments/${ID}`),
		parent: async () => ({ plugins: { state: 'named', running: ['ab-testing'], withheld: [] } }),
	} as never;
}

const experiment = {
	id: ID,
	tenant_id: 'default',
	name: 'signup-button',
	description: '',
	status: 'running',
	traffic_split: {},
	auto_stop_enabled: true,
	significance_threshold: 0.95,
	min_sample_size: 500,
	created_at: '2026-10-11T18:36:53Z',
	updated_at: '2026-10-11T18:36:53Z',
};

const variant = (id: string, name: string) => ({
	id,
	experiment_id: ID,
	name,
	config: '',
	traffic_percentage: 50,
	is_control: name === 'control',
	created_at: '2026-10-11T18:36:53Z',
});

const metric = { id: 'm1', experiment_id: ID, name: 'Signed up', event_name: 'signup', metric_type: 'conversion', created_at: '2026-10-11T18:36:53Z' };

function route(map: Record<string, unknown>) {
	engine.get.mockImplementation(async (url: string) => {
		const path = String(url).split('?')[0] ?? '';
		for (const [suffix, body] of Object.entries(map)) {
			if (path.endsWith(suffix)) {
				if (body instanceof Error) throw body;
				return body;
			}
		}
		throw new ApiError(404, 'not found', {});
	});
}

beforeEach(() => vi.clearAllMocks());

describe('the experiment load', () => {
	// The plugin answers both panels as paged lists. The page read them as
	// bare arrays, handed an object to every loop on the page, and answered
	// 500 for every experiment.
	it('reads variants and metrics out of the paged answer', async () => {
		route({
			'/variants': { data: [variant('v1', 'control'), variant('v2', 'green')], limit: 500, offset: 0, total_count: 2 },
			'/metrics': { data: [metric], limit: 500, offset: 0, total_count: 1 },
			'/results': { experiment_id: ID, status: 'running', variants: [], significant: false, sample_sizes: {} },
			[`/experiments/${ID}`]: experiment,
		});

		const out = (await load(loadEvent())) as Record<string, unknown>;

		expect(out.variants).toEqual([variant('v1', 'control'), variant('v2', 'green')]);
		expect(out.metrics).toEqual([metric]);
	});

	it('asks for every variant and metric in one page', async () => {
		route({
			'/variants': { data: [], total_count: 0 },
			'/metrics': { data: [], total_count: 0 },
			'/results': new ApiError(404, 'none', {}),
			[`/experiments/${ID}`]: experiment,
		});

		await load(loadEvent());

		const asked = engine.get.mock.calls.map(([u]) => String(u));
		expect(asked.find((u) => u.includes('/variants'))).toContain('limit=500');
		expect(asked.find((u) => u.includes('/metrics'))).toContain('limit=500');
	});

	it('keeps the page when one panel cannot be read', async () => {
		route({
			'/variants': new ApiError(503, 'down', {}),
			'/metrics': { data: [metric], total_count: 1 },
			'/results': new ApiError(503, 'down', {}),
			[`/experiments/${ID}`]: experiment,
		});

		const out = (await load(loadEvent())) as Record<string, unknown>;

		expect(out.variants).toEqual([]);
		expect(out.metrics).toEqual([metric]);
		expect(out.results).toBeNull();
	});
});
