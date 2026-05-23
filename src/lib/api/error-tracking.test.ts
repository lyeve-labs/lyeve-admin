import { describe, expect, it } from 'vitest';
import { ApiError } from '@lyeve-labs/client';
import {
	listEvents,
	count,
	errorGate,
	firstSeenWithin,
	severityTone,
	sourceLabel,
	stillFiring,
	triageOrder,
	unacknowledged,
	type ErrorAlert,
} from './error-tracking';

const NOW = new Date('2026-09-23T12:00:00Z');

function alert(over: Partial<ErrorAlert> = {}): ErrorAlert {
	return {
		id: 'a1',
		fingerprint: 'fp1',
		error_code_id: 'c1',
		source_file: 'internal/db/pool.go',
		source_line: 42,
		message_sample: 'connection refused',
		error_count: 100,
		first_seen: '2026-09-20T00:00:00Z',
		last_seen: '2026-09-23T11:58:00Z',
		acknowledged: false,
		acknowledged_by: '',
		created_at: '2026-09-20T00:00:00Z',
		...over,
	};
}

describe('what is worth looking at', () => {
	it('counts distinct failures, not events', () => {
		const rows = [alert(), alert({ id: 'a2', acknowledged: true })];
		expect(unacknowledged(rows)).toHaveLength(1);
	});

	// A new fingerprint is a new failure, which is different from an old one
	// getting louder.
	it('separates a new failure from an old one getting louder', () => {
		const old = alert({ first_seen: '2026-01-01T00:00:00Z', error_count: 900_000 });
		const fresh = alert({ id: 'a2', first_seen: '2026-09-23T06:00:00Z', error_count: 3 });
		expect(firstSeenWithin([old, fresh], 24, NOW).map((a) => a.id)).toEqual(['a2']);
	});

	// An acknowledged alert still firing is seen, not resolved.
	it('reports an acknowledged alert as still happening when it is', () => {
		expect(stillFiring(alert({ acknowledged: true }), 15, NOW)).toBe(true);
		expect(stillFiring(alert({ last_seen: '2026-09-23T09:00:00Z' }), 15, NOW)).toBe(false);
		expect(stillFiring(alert({ last_seen: 'not a date' }), 15, NOW)).toBe(false);
	});
});

describe('triage order', () => {
	// Ordering by count puts a loud old problem above a new one, which hides
	// an outage that started ten minutes ago.
	it('puts unacknowledged first, then what is still happening', () => {
		const loudOld = alert({ id: 'loud', acknowledged: true, error_count: 900_000, last_seen: '2026-09-23T11:59:00Z' });
		const quietNew = alert({ id: 'new', error_count: 2, last_seen: '2026-09-23T11:59:30Z' });
		const staleOpen = alert({ id: 'stale', error_count: 5, last_seen: '2026-09-20T00:00:00Z' });

		expect(triageOrder([loudOld, staleOpen, quietNew], NOW).map((a) => a.id)).toEqual([
			'new',
			'stale',
			'loud',
		]);
	});
});

describe('presentation', () => {
	it('cites a source the way a reader would', () => {
		expect(sourceLabel(alert())).toBe('internal/db/pool.go:42');
		expect(sourceLabel(alert({ source_line: 0 }))).toBe('internal/db/pool.go');
		expect(sourceLabel(alert({ source_file: '' }))).toBe('Source unknown');
	});

	it('marks the severities that mean somebody should act', () => {
		expect(severityTone('CRITICAL')).toBe('danger');
		expect(severityTone('ERROR')).toBe('danger');
		expect(severityTone('WARN')).toBe('warn');
		expect(severityTone('INFO')).toBe('brand');
		expect(severityTone('')).toBe('neutral');
	});

	it('keeps a large count readable', () => {
		expect(count(900)).toBe('900');
		expect(count(1500)).toBe('1.5k');
		expect(count(2_500_000)).toBe('2.5M');
	});
});

describe('the gate', () => {
	it('tells a 402, a 404 and any other failure apart', () => {
		expect(errorGate(new ApiError(402, 'payment required')).state).toBe('locked');
		expect(errorGate(new ApiError(404, 'not found')).state).toBe('absent');
		expect(errorGate(new ApiError(503, 'unavailable')).state).toBe('error');
	});

	it('never reports a failed read as nothing having failed', () => {
		const gate = errorGate(new Error('network'));
		expect(gate.state === 'error' && gate.message).toContain('not a report that none have happened');
	});
});

describe('the event list', () => {
	const client = (body: unknown) => ({ get: async () => body }) as never;

	it('reads the window the install reads, in days', async () => {
		const page = await listEvents(client({ data: [], total_count: 0, hidden_older: 3, window_days: 30 }), 50);
		expect(page).toMatchObject({ hiddenOlder: 3, windowDays: 30 });
	});

	it('reads a null window as every event read', async () => {
		const page = await listEvents(client({ data: [], total_count: 0, hidden_older: 0, window_days: null }), 50);
		expect(page.windowDays).toBeNull();
	});
});
