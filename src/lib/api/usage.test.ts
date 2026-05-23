import { describe, expect, it } from 'vitest';
import { ApiError } from '@lyeve-labs/client';
import {
	blocked,
	bytes,
	enforcementLabel,
	enforcementTone,
	enforces,
	hasAnyLimit,
	limitLabel,
	pending,
	uncheckedDimensions,
	usageGate,
	usageTone,
	usedPct,
	type Quota,
	type QuotaRequest,
} from './usage';

function quota(over: Partial<Quota> = {}): Quota {
	return {
		id: 'q1',
		tenant_id: 'acme',
		requests_limit: 100_000,
		storage_bytes_limit: 10_737_418_240,
		bandwidth_bytes_limit: 107_374_182_400,
		is_hard_limit: true,
		grace_period_hours: 24,
		warn_at_pct_80: true,
		warn_at_pct_90: true,
		block_on_exceeded: true,
		blocked_at: null,
		created_at: '2026-09-01T00:00:00Z',
		updated_at: '2026-09-01T00:00:00Z',
		...over,
	};
}

function request(over: Partial<QuotaRequest> = {}): QuotaRequest {
	return {
		id: 'r1',
		tenant_id: 'acme',
		requested_by: 'ops@acme.example',
		reason: 'launch',
		status: 'pending',
		reviewed_by: '',
		created_at: '2026-09-20T00:00:00Z',
		...over,
	};
}

describe('whether a quota stops anything', () => {
	// A soft quota is a reporting line, and it is what unticked boxes give
	// you. Numbers alone describe enforcement that may not exist.
	it('needs both the hard limit and the block', () => {
		expect(enforces(quota())).toBe(true);
		expect(enforces(quota({ block_on_exceeded: false }))).toBe(false);
		expect(enforces(quota({ is_hard_limit: false }))).toBe(false);
	});

	it('says in words which kind it is', () => {
		expect(enforcementLabel(quota())).toBe('Blocks when exceeded');
		expect(enforcementLabel(quota({ block_on_exceeded: false }))).toContain('does not block');
		expect(enforcementLabel(quota({ is_hard_limit: false, block_on_exceeded: false })))
			.toBe('Reported only, never blocks');
		expect(enforcementTone(quota({ block_on_exceeded: false }))).toBe('warn');
	});

	// Zero reads like the strictest setting and is the loosest.
	it('calls a quota with every limit at zero no limit at all', () => {
		const none = quota({ requests_limit: 0, storage_bytes_limit: 0, bandwidth_bytes_limit: 0 });
		expect(hasAnyLimit(none)).toBe(false);
		expect(enforcementLabel(none)).toBe('No limit set');
		expect(enforcementTone(none)).toBe('neutral');
	});

	it('names the dimensions a partial quota leaves unchecked', () => {
		expect(uncheckedDimensions(quota({ storage_bytes_limit: 0 }))).toEqual(['storage']);
		expect(uncheckedDimensions(quota())).toEqual([]);
	});
});

describe('usage against a limit', () => {
	// An unchecked dimension is not a tenant using none of its allowance.
	it('reports nothing rather than zero where there is no limit', () => {
		expect(usedPct(500, 1000)).toBe(50);
		expect(usedPct(500, 0)).toBeNull();
		expect(usageTone(null)).toBe('neutral');
	});

	it('marks the thresholds a person acts on', () => {
		expect(usageTone(50)).toBe('success');
		expect(usageTone(85)).toBe('warn');
		expect(usageTone(100)).toBe('danger');
		expect(usageTone(140)).toBe('danger');
	});

	it('spells out an unchecked limit rather than printing zero', () => {
		expect(limitLabel(0)).toBe('Unchecked');
		expect(limitLabel(1000)).toBe('1,000');
		expect(limitLabel(2048, true)).toBe('2.0 KB');
	});
});

describe('the queues', () => {
	it('finds the tenants actually stopped', () => {
		expect(blocked([quota(), quota({ id: 'q2', blocked_at: '2026-09-22T00:00:00Z' })])).toHaveLength(1);
	});

	it('finds the requests still waiting on somebody', () => {
		const rows = [request(), request({ id: 'r2', status: 'approved' })];
		expect(pending(rows).map((r) => r.id)).toEqual(['r1']);
	});
});

describe('bytes', () => {
	it('reads at the largest unit that fits', () => {
		expect(bytes(512)).toBe('512 B');
		expect(bytes(10_737_418_240)).toBe('10.0 GB');
		expect(bytes(0)).toBe('0 B');
		expect(bytes(null)).toBe('0 B');
	});
});

describe('the gate', () => {
	it('tells a 402, a 404 and any other failure apart', () => {
		expect(usageGate(new ApiError(402, 'payment required')).state).toBe('locked');
		expect(usageGate(new ApiError(404, 'not found')).state).toBe('absent');
		expect(usageGate(new ApiError(503, 'unavailable')).state).toBe('error');
	});

	it('never reports a failed read as nobody being over their limit', () => {
		const gate = usageGate(new Error('network'));
		expect(gate.state === 'error' && gate.message).toContain('not a report that nobody is over their limit');
	});
});
