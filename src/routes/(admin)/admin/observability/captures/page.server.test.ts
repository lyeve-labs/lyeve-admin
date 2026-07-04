import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiError } from '@lyeve-labs/client';

const api = vi.hoisted(() => ({
	listCaptures: vi.fn(),
	listCaptureRules: vi.fn(),
	listReplaySets: vi.fn(),
	createCaptureRule: vi.fn(),
	updateCaptureRule: vi.fn(),
	deleteCaptureRule: vi.fn(),
	createReplaySet: vi.fn(),
	deleteReplaySet: vi.fn(),
	replaySet: vi.fn(),
}));

vi.mock('$lib/api/request-capture', async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	...api,
}));

vi.mock('$lib/server/authz', () => ({
	authedClient: vi.fn(() => ({})),
	requireRole: vi.fn(async () => ({ id: 'u1', roles: ['admin'] })),
}));

import { load, actions } from './+page.server';

type Loaded = Exclude<Awaited<ReturnType<typeof load>>, void>;

function loadEvent(plugins?: unknown) {
	return {
		url: new URL('http://admin/admin/observability/captures'),
		fetch: vi.fn(),
		cookies: {},
		parent: async () => ({ user: { roles: ['admin'] }, plugins }),
	} as never;
}

function formEvent(fields: Record<string, string | string[]>) {
	const body = new FormData();
	for (const [k, v] of Object.entries(fields)) {
		for (const one of Array.isArray(v) ? v : [v]) body.append(k, one);
	}
	return {
		request: new Request('http://admin/admin/observability/captures', { method: 'POST', body }),
		cookies: {},
		fetch: vi.fn(),
	} as never;
}

const capture = {
	id: 'c1',
	captured_at: '2026-10-06T10:00:00Z',
	method: 'GET',
	url: 'http://localhost:3002/api/v1/content/posts',
	status_code: 200,
	duration_ms: 12.5,
	ttl_seconds: 86400,
};

beforeEach(() => {
	vi.clearAllMocks();
	api.listCaptures.mockResolvedValue({ data: [capture], total_count: 1, licensed: false });
	api.listCaptureRules.mockResolvedValue({ data: [], licensed: false });
	api.listReplaySets.mockResolvedValue({ data: [], licensed: false });
});

describe('captures load', () => {
	it('reads the captures, rules and sets, and takes licensed from the plugin', async () => {
		const result = (await load(loadEvent())) as Loaded;
		expect(result.gate).toEqual({ state: 'ok' });
		expect(result.captures).toEqual([capture]);
		expect(result.licensed).toBe(false);
		expect(result.rulesRead).toBe(true);
		expect(result.setsRead).toBe(true);
	});

	it('reports a refused captures read through the gate and reads nothing else', async () => {
		api.listCaptures.mockRejectedValue(new ApiError(404, 'not found'));
		const result = (await load(loadEvent())) as Loaded;
		expect(result.gate).toEqual({ state: 'absent' });
		expect(api.listCaptureRules).not.toHaveBeenCalled();
	});

	it('keeps the captures when the rules read fails, and says the rules were not read', async () => {
		api.listCaptureRules.mockRejectedValue(new Error('down'));
		const result = (await load(loadEvent())) as Loaded;
		expect(result.rulesRead).toBe(false);
		expect(result.captures).toHaveLength(1);
	});
});

describe('capture rule actions', () => {
	it('sends the sample as a fraction and the retention in seconds', async () => {
		api.createCaptureRule.mockResolvedValue({});
		await actions.createRule(
			formEvent({
				route_pattern: '/api/v1/orders/{id}',
				method: 'post',
				sample_percent: '25',
				retention_seconds: String(30 * 86400),
				enabled: 'true',
			}),
		);
		expect(api.createCaptureRule).toHaveBeenCalledWith(expect.anything(), {
			route_pattern: '/api/v1/orders/{id}',
			method: 'POST',
			sample_rate: 0.25,
			retention_seconds: 2592000,
			enabled: true,
		});
	});

	it('refuses a retention past 30 days before the round trip', async () => {
		const out = (await actions.createRule(
			formEvent({ route_pattern: '/api/v1/**', method: '*', sample_percent: '100', retention_seconds: String(31 * 86400) }),
		)) as { status: number };
		expect(out.status).toBe(400);
		expect(api.createCaptureRule).not.toHaveBeenCalled();
	});

	it('returns the license refusal so the page renders it', async () => {
		api.createCaptureRule.mockRejectedValue(
			new ApiError(402, 'payment_required', { error: 'payment_required', plugin: 'example', feature: 'feature:example_feature' }),
		);
		const out = (await actions.createRule(
			formEvent({ route_pattern: '/api/v1/**', method: '*', sample_percent: '100', retention_seconds: '3600' }),
		)) as { status: number; data: { refused: { kind: string } } };
		expect(out.status).toBe(402);
		expect(out.data.refused.kind).toBe('feature');
	});
});

describe('replay sets', () => {
	it('creates a set from the selected captures in order, without repeats', async () => {
		api.createReplaySet.mockResolvedValue({});
		await actions.createSet(formEvent({ name: 'checkout', capture_id: ['c2', 'c1', 'c2'] }));
		expect(api.createReplaySet).toHaveBeenCalledWith(expect.anything(), { name: 'checkout', capture_ids: ['c2', 'c1'] });
	});

	it('refuses a set past 50 captures', async () => {
		const ids = Array.from({ length: 51 }, (_, i) => `c${i}`);
		const out = (await actions.createSet(formEvent({ name: 'big', capture_id: ids }))) as { status: number };
		expect(out.status).toBe(400);
		expect(api.createReplaySet).not.toHaveBeenCalled();
	});

	it('replays a set and returns each capture diff', async () => {
		const replay = {
			set_id: 's1',
			results: [{ capture_id: 'c1', replay_id: 'r1', diff: { status_match: true, status_code1: 200, status_code2: 200 } }],
		};
		api.replaySet.mockResolvedValue(replay);
		expect(await actions.replaySet(formEvent({ id: 's1' }))).toEqual({ replay });
		expect(api.replaySet).toHaveBeenCalledWith(expect.anything(), 's1', false);
	});

	// A set holding a write is refused before any of it runs, so the page asks
	// again with the writes confirmed rather than reporting a failure.
	it('asks to confirm the writes when the plugin refuses a set that holds one', async () => {
		api.replaySet.mockRejectedValue(
			new ApiError(428, 'reworded by the plugin', { error: 'reworded by the plugin', code: 'request_capture.confirm_writes' }),
		);
		const out = (await actions.replaySet(formEvent({ id: 's1' }))) as { status: number; data: { needsWrites: string } };
		expect(out.status).toBe(428);
		expect(out.data.needsWrites).toBe('s1');
	});

	it('relays the other confirmation rather than asking about writes', async () => {
		const message = 'replay requires confirm_replay: true, which acknowledges auth header substitution';
		api.replaySet.mockRejectedValue(new ApiError(428, message, { error: message, code: 'request_capture.confirm_replay' }));
		const out = (await actions.replaySet(formEvent({ id: 's1' }))) as {
			status: number;
			data: { needsWrites?: string; error: string };
		};
		expect(out.data.needsWrites).toBeUndefined();
		expect(out.data.error).toBe(message);
	});

	it('sends the writes confirmation when the operator gave it', async () => {
		api.replaySet.mockResolvedValue({ set_id: 's1', results: [] });
		await actions.replaySet(formEvent({ id: 's1', confirm_mutating: 'true' }));
		expect(api.replaySet).toHaveBeenCalledWith(expect.anything(), 's1', true);
	});
});
