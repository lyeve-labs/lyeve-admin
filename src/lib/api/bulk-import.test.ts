import { describe, expect, it } from 'vitest';
import { ApiError } from '@lyeve-labs/client';
import {
	OUTCOME_LABELS,
	cancelable,
	importGate,
	outcome,
	outcomeTone,
	progress,
	rejectionRate,
	rollbackable,
	written,
	type ImportJob,
} from './bulk-import';

function job(over: Partial<ImportJob> = {}): ImportJob {
	return {
		id: 'j1',
		content_type: 'articles',
		source_format: 'csv',
		source_name: 'articles.csv',
		total_rows: 100,
		processed_rows: 100,
		errored_rows: 0,
		inserted_rows: 100,
		updated_rows: 0,
		skipped_rows: 0,
		status: 'completed',
		dry_run: false,
		created_at: '2026-09-22T10:00:00Z',
		finished_at: '2026-09-22T10:05:00Z',
		...over,
	};
}

describe('what actually happened', () => {
	// A job completes successfully having skipped every row it could not
	// parse, so 'completed' beside four thousand errored rows is a job that
	// imported nothing and reported success.
	it('separates a clean run from one that rejected rows', () => {
		expect(outcome(job())).toBe('clean');
		expect(outcome(job({ errored_rows: 20, inserted_rows: 80 }))).toBe('partial');
		expect(outcomeTone('partial')).toBe('warn');
	});

	it('calls out a job that finished having written nothing', () => {
		const nothing = job({ errored_rows: 100, inserted_rows: 0, updated_rows: 0 });
		expect(outcome(nothing)).toBe('nothing');
		expect(outcomeTone('nothing')).toBe('danger');
		expect(OUTCOME_LABELS.nothing).toContain('imported nothing');
	});

	it('does not judge a job that has not finished', () => {
		expect(outcome(job({ status: 'running', errored_rows: 5 }))).toBe('running');
		expect(outcome(job({ status: 'pending' }))).toBe('running');
		expect(outcome(job({ status: 'canceled' }))).toBe('stopped');
		expect(outcome(job({ status: 'failed' }))).toBe('failed');
	});

	it('counts written rows as inserted plus updated, not processed', () => {
		expect(written(job({ inserted_rows: 60, updated_rows: 20, processed_rows: 100 }))).toBe(80);
	});
});

describe('the controls a job offers', () => {
	// A dry run wrote nothing, so a rollback of one is a no-op dressed as a
	// repair.
	it('never offers to roll back a dry run', () => {
		expect(rollbackable(job({ dry_run: true }))).toBe(false);
		expect(rollbackable(job())).toBe(true);
	});

	it('offers no rollback where nothing was written', () => {
		expect(rollbackable(job({ inserted_rows: 0, updated_rows: 0 }))).toBe(false);
		expect(rollbackable(job({ status: 'running' }))).toBe(false);
	});

	it('offers cancellation only while a job can still stop', () => {
		expect(cancelable(job({ status: 'running' }))).toBe(true);
		expect(cancelable(job({ status: 'pending' }))).toBe(true);
		expect(cancelable(job())).toBe(false);
	});
});

describe('progress', () => {
	// total_rows is zero until the file has been counted, so a bar drawn from
	// processed alone sits at zero and then jumps.
	it('is complete once the job is, whatever the counters say', () => {
		expect(progress(job({ total_rows: 0, processed_rows: 0 }))).toBe(1);
		expect(progress(job({ status: 'running', total_rows: 0, processed_rows: 40 }))).toBe(0);
		expect(progress(job({ status: 'running', total_rows: 100, processed_rows: 40 }))).toBe(0.4);
	});

	it('reports a rejection rate only once rows have been read', () => {
		expect(rejectionRate(job({ processed_rows: 100, errored_rows: 25 }))).toBe(25);
		expect(rejectionRate(job({ processed_rows: 0 }))).toBeNull();
	});
});

describe('the gate', () => {
	it('tells a 402, a 404 and any other failure apart', () => {
		expect(importGate(new ApiError(402, 'payment required')).state).toBe('locked');
		expect(importGate(new ApiError(404, 'not found')).state).toBe('absent');
		expect(importGate(new ApiError(503, 'unavailable')).state).toBe('error');
	});

	it('never reports a failed read as no imports having run', () => {
		const gate = importGate(new Error('network'));
		expect(gate.state === 'error' && gate.message).toContain('not a report that none have run');
	});
});

describe('reading the plugin', () => {
	it('reads the history from the jobs key the plugin answers with', async () => {
		const { listJobs } = await import('./bulk-import');
		const client = { get: async () => ({ jobs: [job()], total_count: 7 }) } as never;
		const page = await listJobs(client, 25, 0);
		expect(page.data).toHaveLength(1);
		expect(page.total_count).toBe(7);
	});

	it('reads a job\'s rows one level down in the envelope', async () => {
		const { listRows } = await import('./bulk-import');
		const client = {
			get: async () => ({ data: { rows: [{ id: 'r', row_index: 4, status: 'errored' }], total_count: 9 } }),
		} as never;
		const got = await listRows(client, 'j1', 'errored', 100);
		expect(got.rows[0].row_index).toBe(4);
		expect(got.total).toBe(9);
	});
});

describe('outcomes after the fact', () => {
	it('names a rollback rather than calling it stopped', () => {
		expect(outcome(job({ status: 'rolled_back' }))).toBe('rolled_back');
		expect(OUTCOME_LABELS.rolled_back).toBe('Rolled back');
	});

	it('offers a rollback on a job that created entries, rejected rows or not', () => {
		expect(rollbackable(job({ status: 'completed_with_errors', errored_rows: 3 }))).toBe(true);
		expect(rollbackable(job({ inserted_rows: 0, updated_rows: 5 }))).toBe(false);
	});
});

describe('mapping', () => {
	it('offers the entry columns first, then the fields the schema writes', async () => {
		const { mappingTargets } = await import('./bulk-import');
		const targets = mappingTargets([
			{ name: 'id', field_type: 'uid', system: true },
			{ name: 'views', field_type: 'number' },
			{ name: 'featured', field_type: 'boolean' },
			{ name: 'tags', field_type: 'json' },
		]);
		expect(targets.map((t) => t.value)).toEqual(['entry.slug', 'entry.title', 'entry.status', 'views', 'featured', 'tags']);
		expect(targets.map((t) => t.dataType).slice(3)).toEqual(['number', 'boolean', 'json']);
	});

	it('guesses by name, ignoring case and separators, and leaves the rest unmapped', async () => {
		const { mappingTargets, suggestMapping, mappingsFrom } = await import('./bulk-import');
		const targets = mappingTargets([{ name: 'page_views', field_type: 'number' }, { name: 'summary' }]);
		const chosen = suggestMapping(['Slug', 'Name', 'Page Views', 'Other'], targets);
		expect(chosen).toEqual({
			'entry.slug': 'Slug',
			'entry.title': 'Name',
			'entry.status': '',
			page_views: 'Page Views',
			summary: '',
		});
		expect(mappingsFrom(chosen, targets)).toEqual([
			{ source_field: 'Slug', target_field: 'entry.slug', data_type: 'string' },
			{ source_field: 'Name', target_field: 'entry.title', data_type: 'string' },
			{ source_field: 'Page Views', target_field: 'page_views', data_type: 'number' },
		]);
	});

	it('reads the format from a file name', async () => {
		const { formatFromName } = await import('./bulk-import');
		expect(formatFromName('Export.JSONL')).toBe('ndjson');
		expect(formatFromName('a.yml')).toBe('yaml');
		expect(formatFromName('notes.txt')).toBeNull();
	});
});
