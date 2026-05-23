import { describe, expect, it } from 'vitest';
import { ApiError } from '@lyeve-labs/client';
import {
	everyLabel,
	millis,
	probeHealth,
	probeTarget,
	probeTone,
	probeType,
	syntheticGate,
	type Probe,
} from './synthetic';

function probe(over: Partial<Probe> = {}): Probe {
	return {
		id: 'p1',
		tenant_id: 'default',
		name: 'Homepage',
		type: 'health_check',
		enabled: true,
		config: { url: 'https://example.com/healthz', expected_status: 200 },
		interval_seconds: 300,
		timeout_seconds: 10,
		regions: null,
		alert_threshold: 3,
		last_run_at: '2026-09-22T10:00:00Z',
		last_status: 'pass',
		created_at: '2026-09-01T00:00:00Z',
		updated_at: '2026-09-01T00:00:00Z',
		...over,
	};
}

describe('what a probe row says about itself', () => {
	it('separates passing from failing', () => {
		expect(probeHealth(probe())).toBe('passing');
		expect(probeHealth(probe({ last_status: 'fail' }))).toBe('failing');
	});

	// A paused probe's last pass is as stale as the pause is long. Reading it
	// as green is how an outage goes unnoticed on a dashboard.
	it('lets paused outrank a stale pass', () => {
		expect(probeHealth(probe({ enabled: false, last_status: 'pass' }))).toBe('paused');
		expect(probeHealth(probe({ enabled: false, last_status: 'fail' }))).toBe('paused');
		expect(probeTone('paused')).toBe('neutral');
	});

	// No result is not a good result.
	it('says never run rather than passing when there is no result', () => {
		expect(probeHealth(probe({ last_run_at: null, last_status: null }))).toBe('unrun');
		expect(probeHealth(probe({ last_run_at: '2026-09-22T10:00:00Z', last_status: null }))).toBe('unrun');
		expect(probeTone('unrun')).toBe('warn');
	});

	it('uses the kit vocabulary for every level', () => {
		expect(probeTone('passing')).toBe('success');
		expect(probeTone('failing')).toBe('danger');
	});
});

describe('what a probe checks', () => {
	// Two health checks against different URLs are different probes. Naming
	// only the type would print the same row twice.
	it('reads the target out of the config, per type', () => {
		expect(probeTarget(probe())).toBe('https://example.com/healthz');
		expect(
			probeTarget(
				probe({ type: 'api_canary', config: { endpoint_base: 'https://a.example.com', resource_path: '/v1/x' } }),
			),
		).toBe('https://a.example.com/v1/x');
		expect(probeTarget(probe({ type: 'login_flow', config: { login_url: 'https://a/login' } }))).toBe(
			'https://a/login',
		);
		expect(probeTarget(probe({ type: 'webhook_delivery', config: { webhook_url: 'https://a/hook' } }))).toBe(
			'https://a/hook',
		);
	});

	it('says what is missing rather than printing an empty cell', () => {
		expect(probeTarget(probe({ config: {} }))).toBe('No URL set');
		expect(probeTarget(probe({ type: 'api_canary', config: {} }))).toBe('No endpoint set');
	});
});

describe('intervals in words', () => {
	// The number on screen is the one somebody compares against an alerting
	// threshold elsewhere, so it is exact or it is in seconds.
	it('rounds nothing', () => {
		expect(everyLabel(60)).toBe('Every 1 minute');
		expect(everyLabel(300)).toBe('Every 5 minutes');
		expect(everyLabel(3600)).toBe('Every 1 hour');
		expect(everyLabel(7200)).toBe('Every 2 hours');
		expect(everyLabel(90)).toBe('Every 90 seconds');
		expect(everyLabel(45)).toBe('Every 45 seconds');
	});

	it('says a probe is not scheduled rather than running every zero seconds', () => {
		expect(everyLabel(0)).toBe('Not scheduled');
		expect(everyLabel(-1)).toBe('Not scheduled');
		expect(everyLabel(Number.NaN)).toBe('Not scheduled');
	});
});

describe('response times', () => {
	it('keeps milliseconds until they stop reading as milliseconds', () => {
		expect(millis(0)).toBe('0 ms');
		expect(millis(342)).toBe('342 ms');
		expect(millis(999)).toBe('999 ms');
		expect(millis(1500)).toBe('1.50 s');
	});

	it('prints nothing it was not given', () => {
		expect(millis(null)).toBe('-');
		expect(millis(undefined)).toBe('-');
	});
});

describe('the type the form may send', () => {
	it('accepts the four the engine runs and refuses the rest', () => {
		expect(probeType('health_check')).toBe('health_check');
		expect(probeType('webhook_delivery')).toBe('webhook_delivery');
		expect(probeType('ping')).toBeNull();
		expect(probeType('')).toBeNull();
	});
});

describe('the gate sorts a refusal by what it means', () => {
	it('tells a 402, a 404 and any other failure apart', () => {
		expect(syntheticGate(new ApiError(402, 'payment required')).state).toBe('locked');
		expect(syntheticGate(new ApiError(404, 'not found')).state).toBe('absent');
		expect(syntheticGate(new ApiError(503, 'database error')).state).toBe('error');
	});

	// An operator reading "nothing is wrong" after a failed read is the worst
	// outcome a monitoring page can produce.
	it('never reports a failed read as everything passing', () => {
		const gate = syntheticGate(new Error('network'));
		expect(gate.state === 'error' && gate.message).toContain('not a report that everything is passing');
	});
});
