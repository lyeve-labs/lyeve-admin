import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@lyeve-labs/client';

const engine = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock('$lib/server/authz', async (importOriginal) => ({
	...((await importOriginal()) as object),
	authedClient: vi.fn(() => engine),
	requireRole: vi.fn(async () => ({ id: 'u1', roles: ['admin'] })),
}));

import { actions, load } from './+page.server';

type Loaded = Exclude<Awaited<ReturnType<typeof load>>, void>;
type Failure = { status: number; data: Record<string, unknown> };

const PROBE = { id: 'p1', name: 'Homepage', type: 'health_check', enabled: true, config: {}, interval_seconds: 300, timeout_seconds: 10, alert_threshold: 3 };

function loadEvent(query = '') {
	return {
		url: new URL(`http://localhost/admin/observability/synthetic${query}`),
		parent: async () => ({ plugins: { state: 'named', running: ['synthetic-monitoring'], withheld: [] } }),
	} as never;
}

function actionEvent(fields: Record<string, string>) {
	const data = new FormData();
	for (const [k, v] of Object.entries(fields)) data.set(k, v);
	return { request: { formData: async () => data } } as never;
}

function route(channels: unknown) {
	engine.get.mockImplementation(async (url: string) => {
		if (url.includes('/alert-channels')) {
			if (channels instanceof Error) throw channels;
			return channels;
		}
		if (url.includes('/probes')) return { data: [PROBE], total_count: 1 };
		if (url.includes('/alerts')) return { data: [] };
		throw new ApiError(404, 'not found', {});
	});
}

beforeEach(() => vi.clearAllMocks());

describe('the notice channels load', () => {
	it('reads no channels until the address names a probe', async () => {
		route({ channels: {}, licensed: true });
		const out = (await load(loadEvent())) as Loaded;
		expect(out.channelsFor).toBeNull();
		expect(engine.get.mock.calls.some(([u]) => String(u).includes('/alert-channels'))).toBe(false);
	});

	it('reads the named probe channels and whether a paid one would be taken', async () => {
		route({ channels: { email: ['ops@example.com'], slack_url: 'https://hooks.slack.com/...1a2b' }, licensed: false });
		const out = (await load(loadEvent('?channels=p1'))) as Loaded;
		expect(engine.get).toHaveBeenCalledWith('/api/admin/synthetic-monitoring/probes/p1/alert-channels');
		expect(out.channelsFor?.read).toEqual({
			channels: { email: ['ops@example.com'], slack_url: 'https://hooks.slack.com/...1a2b' },
			licensed: false,
		});
	});

	it('keeps the probes when the channels read fails, and says so in the drawer', async () => {
		route(new ApiError(500, 'internal error', {}));
		const out = (await load(loadEvent('?channels=p1'))) as Loaded;
		expect(out.probes).toHaveLength(1);
		expect(out.channelsFor).toMatchObject({ read: null, gate: { state: 'error' } });
	});
});

describe('saving notice channels', () => {
	it('puts the channels, a masked value as it was read', async () => {
		engine.put.mockResolvedValue({ channels: {}, licensed: true });
		await actions.channels(actionEvent({ id: 'p1', channel_email: 'ops@example.com', channel_pagerduty_routing_key: '...cdef' }));
		expect(engine.put).toHaveBeenCalledWith('/api/admin/synthetic-monitoring/probes/p1/alert-channels', {
			email: ['ops@example.com'],
			pagerduty_routing_key: '...cdef',
		});
	});

	it('clears every channel with null when the form names none', async () => {
		engine.put.mockResolvedValue({ channels: {}, licensed: true });
		await actions.channels(actionEvent({ id: 'p1', channel_email: '' }));
		expect(engine.put.mock.calls[0][1]).toBeNull();
	});

	it('keeps a refusal in the drawer that asked', async () => {
		engine.put.mockRejectedValue(
			new ApiError(402, 'payment_required', { error: 'payment_required', plugin: 'synthetic-monitoring', feature: 'feature:example_feature' }),
		);
		const out = (await actions.channels(actionEvent({ id: 'p1', channel_slack_url: 'https://hooks.slack.com/services/x' }))) as Failure;
		expect(out.status).toBe(402);
		expect(out.data).toMatchObject({ channels: true, refused: { kind: 'feature', feature: 'example-feature' } });
	});

	it('answers the signing secret a new webhook URL got', async () => {
		engine.put.mockResolvedValue({ channels: { webhook_url: 'https://ops.example.com/...abcd' }, licensed: true, webhook_signing_secret: 'k'.repeat(64) });
		const out = await actions.channels(actionEvent({ id: 'p1', channel_webhook_url: 'https://ops.example.com/probe' }));
		expect(out).toEqual({ channelsSaved: 'p1', signingSecret: 'k'.repeat(64) });
	});
});

describe('running a probe now', () => {
	it('reports a run that failed in one of its regions as failed', async () => {
		engine.post.mockResolvedValue([
			{ id: 'r1', probe_id: 'p1', status: 'pass', response_time_ms: 90, region: 'us-east', created_at: '' },
			{ id: 'r2', probe_id: 'p1', status: 'fail', response_time_ms: 3000, region: 'eu-west', created_at: '' },
		]);
		const out = await actions.run(actionEvent({ id: 'p1' }));
		expect(engine.post).toHaveBeenCalledWith('/api/admin/synthetic-monitoring/probes/p1/run', {});
		expect(out).toEqual({ ran: 'p1', status: 'fail', ms: 3000, failed: 1, regions: 2 });
	});
});

describe('the probe limits load', () => {
	it('hands the form the floor the plugin answers', async () => {
		route({ channels: {}, licensed: true });
		const probesOnly = engine.get.getMockImplementation()!;
		engine.get.mockImplementation(async (url: string) =>
			url.endsWith('/limits') ? { probes: { limit: 0, current: 1 }, min_interval_seconds: 15 } : probesOnly(url),
		);
		const out = (await load(loadEvent())) as Loaded;
		expect(out.limits).toEqual({ probes: { limit: 0, current: 1 }, minIntervalSeconds: 15 });
	});

	it('keeps the page when the limits cannot be read', async () => {
		route({ channels: {}, licensed: true });
		const out = (await load(loadEvent())) as Loaded;
		expect(out.probes).toHaveLength(1);
		expect(out.limits).toBeNull();
	});
});

describe('saving a probe', () => {
	// The plugin holds the floor for the install's license and refuses with
	// the reason, so the console no longer refuses an interval of its own.
	it('sends a short interval for the plugin to accept or refuse', async () => {
		engine.post.mockResolvedValue(PROBE);
		await actions.create(
			actionEvent({ name: 'Homepage', type: 'health_check', url: 'https://example.com', interval_seconds: '15', timeout_seconds: '10' }),
		);
		expect(engine.post).toHaveBeenCalledWith(
			'/api/admin/synthetic-monitoring/probes',
			expect.objectContaining({ interval_seconds: 15 }),
		);
	});
});

describe('the probe list load', () => {
	it('keeps a failed alert read as a gate rather than no alerts', async () => {
		engine.get.mockImplementation(async (url: string) => {
			if (url.includes('/probes')) return { data: [PROBE], total_count: 1 };
			if (url.includes('/alerts')) throw new ApiError(503, 'down', {});
			throw new ApiError(404, 'not found', {});
		});
		const out = (await load(loadEvent())) as Loaded;
		expect(out.alerts).toEqual({ ok: false, gate: { state: 'unavailable' } });
		expect(out.probes).toHaveLength(1);
	});

	it('sends an offset past the end back to the last page', async () => {
		engine.get.mockImplementation(async (url: string) => {
			if (url.includes('/probes')) return { data: [], total_count: 30 };
			if (url.includes('/alerts')) return { data: [] };
			throw new ApiError(404, 'not found', {});
		});
		await expect(load(loadEvent('?limit=25&offset=200'))).rejects.toMatchObject({
			status: 307,
			location: expect.stringContaining('offset=25'),
		});
	});
});

describe('a plugin that answers every probe', () => {
	// The plugin ignores the window and answers a bare array of every probe.
	// Read as one page, page two repeated page one.
	const many = Array.from({ length: 30 }, (_, i) => ({ ...PROBE, id: `p${i}`, name: `probe ${i}`, enabled: i % 10 !== 0 }));

	it('cuts the page from every probe and counts them all', async () => {
		engine.get.mockImplementation(async (url: string) => {
			if (url.includes('/probes')) return many;
			if (url.includes('/alerts')) return { data: [] };
			throw new ApiError(404, 'not found', {});
		});
		const out = (await load(loadEvent('?limit=25&offset=25'))) as Loaded;
		expect(out.probes.map((p: { id: string }) => p.id)).toEqual(['p25', 'p26', 'p27', 'p28', 'p29']);
		expect(out.total).toBe(30);
		expect(out.hasMore).toBe(false);
		expect(out.counts?.paused).toBe(3);
	});

	it('sends an offset past every probe back to the last page', async () => {
		engine.get.mockImplementation(async (url: string) => {
			if (url.includes('/probes')) return many;
			if (url.includes('/alerts')) return { data: [] };
			throw new ApiError(404, 'not found', {});
		});
		await expect(load(loadEvent('?limit=25&offset=100'))).rejects.toMatchObject({
			status: 307,
			location: expect.stringContaining('offset=25'),
		});
	});
});

describe('which surface a failure belongs to', () => {
	it('tags a failed probe save for the probe drawer', async () => {
		const out = (await actions.create(actionEvent({ name: '' }))) as { data: Record<string, unknown> };
		expect(out.data.drawer).toBe('probe');
	});
});
