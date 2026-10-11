import { describe, expect, it } from 'vitest';
import { ApiError } from '@lyeve-labs/client';
import {
	callerOf,
	durationTone,
	noSuggestionText,
	oneLine,
	queryGate,
	readAnalysis,
	type QueryLogEntry,
} from './query-monitor';

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

describe('readAnalysis', () => {
	const captured = { id: 'q1', query_hash: 'h', query_text: 'GET /api/admin/users', duration_ms: 900, engine: 'postgres', captured_at: '' };

	it('reads the entries, the plans read and the reason none was', () => {
		const read = readAnalysis('postgres', {
			engine: 'postgres',
			entries: [captured],
			plans_read: 0,
			no_plans_reason: 'source_missing',
		});

		expect(read.entries).toHaveLength(1);
		expect(read.plansRead).toBe(0);
		expect(read.noPlansReason).toBe('source_missing');
	});

	it('counts the plans itself when the answer does not', () => {
		const read = readAnalysis('postgres', {
			engine: 'postgres',
			entries: [captured, { ...captured, id: 'q2', plan_text: '[]' }, { ...captured, id: 'q3', engine: 'mysql', plan_text: '{}' }],
		});

		expect(read.plansRead).toBe(1);
	});

	it("reads SQL Server's missing indexes and no plan count", () => {
		const read = readAnalysis('mssql', {
			top_cpu_time: [],
			missing_indexes: [{ table: 't', columns: ['a'], reason: 'r' }],
		});

		expect(read.missingIndexes).toHaveLength(1);
		expect(read.plansRead).toBeNull();
	});

	it('drops a reason it does not know', () => {
		expect(readAnalysis('mysql', { entries: [], plans_read: 0, no_plans_reason: 'gremlins' }).noPlansReason).toBeNull();
	});
});

describe('noSuggestionText', () => {
	const none = (reason: string | null) =>
		readAnalysis('postgres', { entries: [], plans_read: 0, no_plans_reason: reason });

	it('never says the plans use an index when none was read', () => {
		for (const reason of ['other_dialect', 'capture_disabled', 'source_missing', 'source_unreadable', 'none_captured', null]) {
			const text = noSuggestionText('postgres', none(reason));
			expect(text, String(reason)).toMatch(/^No plans were read/);
			expect(text, String(reason)).not.toContain('index');
		}
	});

	it('names the extension that is missing on PostgreSQL and the source on MySQL', () => {
		expect(noSuggestionText('postgres', none('source_missing'))).toContain('pg_stat_statements');
		expect(
			noSuggestionText('mysql', readAnalysis('mysql', { entries: [], plans_read: 0, no_plans_reason: 'source_missing' })),
		).toContain('performance_schema');
	});

	it('counts the plans it read when none needs an index', () => {
		expect(noSuggestionText('postgres', readAnalysis('postgres', { entries: [], plans_read: 3 }))).toBe(
			'Nothing to suggest in the 3 plans the analyzer read.',
		);
	});
});
