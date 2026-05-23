import { describe, expect, it } from 'vitest';
import { ApiError } from '@lyeve-labs/client';
import { callerOf, durationTone, oneLine, queryGate, type QueryLogEntry } from './query-monitor';

function entry(over: Partial<QueryLogEntry> = {}): QueryLogEntry {
	return {
		id: 'q1',
		query_hash: 'h',
		query_text: 'SELECT 1',
		duration_ms: 10,
		engine: 'postgres',
		captured_at: '2026-09-22T10:00:00Z',
		...over,
	};
}

describe('queryGate', () => {
	// The four refusals want different words. Reading them all as "nothing was
	// slow" is the failure this sorting exists to prevent.
	it('reads a 402 as not enabled', () => {
		expect(queryGate(new ApiError(402, 'nope')).state).toBe('locked');
	});

	it('reads a 404 as the plugin missing from this build', () => {
		expect(queryGate(new ApiError(404, 'nope')).state).toBe('absent');
	});

	it('reads a 503 as the capture store', () => {
		expect(queryGate(new ApiError(503, 'nope')).state).toBe('unavailable');
	});

	it('keeps the banner for anything else, and says it is not a report of none', () => {
		const gate = queryGate(new Error('socket'));
		expect(gate.state).toBe('error');
		expect(gate.state === 'error' && gate.message).toContain('not a report that nothing was slow');
	});
});

describe('durationTone', () => {
	it('names the vocabulary the kit accepts, not a synonym', () => {
		// 'warning' type-checks nowhere in the kit and silently renders neutral.
		expect(durationTone(300)).toBe('warn');
	});

	it('escalates past a second', () => {
		expect(durationTone(1000)).toBe('danger');
		expect(durationTone(999)).toBe('warn');
		expect(durationTone(249)).toBe('neutral');
	});
});

describe('oneLine', () => {
	// Captured SQL arrives with the newlines and indentation the caller wrote,
	// which in a table cell reads as a blank row followed by a wrapped one.
	it('flattens the whitespace the caller wrote', () => {
		expect(oneLine('SELECT\n  a,\n  b\nFROM t')).toBe('SELECT a, b FROM t');
	});

	it('truncates to the width it was given', () => {
		expect(oneLine('x'.repeat(200), 20)).toHaveLength(20);
		expect(oneLine('x'.repeat(200), 20).endsWith('...')).toBe(true);
	});

	it('leaves a short statement alone', () => {
		expect(oneLine('SELECT 1')).toBe('SELECT 1');
	});
});

describe('callerOf', () => {
	it('is nothing when the sampler caught no caller', () => {
		expect(callerOf(entry())).toBeNull();
	});

	it('is the file alone when there is no line', () => {
		expect(callerOf(entry({ caller_file: 'store.go' }))).toBe('store.go');
	});

	it('joins the file and line the way an editor opens them', () => {
		expect(callerOf(entry({ caller_file: 'store.go', caller_line: 42 }))).toBe('store.go:42');
	});
});
