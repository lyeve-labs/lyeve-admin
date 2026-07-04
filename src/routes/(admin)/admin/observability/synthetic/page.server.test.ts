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
		route(new ApiError(503, 'down', {}));
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
