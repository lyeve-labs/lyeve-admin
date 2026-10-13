// @vitest-environment jsdom
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/navigation', () => ({
	goto: vi.fn(async () => {}),
	invalidateAll: vi.fn(async () => {}),
}));

import QueriesPage from './+page.svelte';
import type { AnalysisRead, NoPlansReason, QueryLogEntry } from '$lib/api/query-monitor';

afterEach(cleanup);

function read(entries: QueryLogEntry[], plansRead: number | null = null, noPlansReason: NoPlansReason | null = null): AnalysisRead {
	return { entries, missingIndexes: [], plansRead, noPlansReason };
}

function entry(over: Partial<QueryLogEntry> = {}): QueryLogEntry {
	return {
		id: 'q1',
		query_hash: 'h1',
		query_text: 'SELECT * FROM sys_content WHERE tenant_id = $1',
		duration_ms: 1400,
		rows_returned: 12,
		engine: 'postgres',
		captured_at: '2026-09-22T10:00:00Z',
		...over,
	};
}

const props = (over: Record<string, unknown> = {}) => ({
	data: {
		entries: [entry()],
		total: 1,
		limit: 50,
		offset: 0,
		gate: { state: 'ok' },
		dialect: null,
		analysis: null,
		analyzeFailed: false,
		licensed: true,
		...over,
	} as never,
});

describe('Slow queries gate', () => {
	it('shows the not-enabled state when the engine refuses the routes', () => {
		const { container } = render(QueriesPage, { props: props({ gate: { state: 'locked', upgradeUrl: '' } }) });

		expect(container.textContent).toContain('Not enabled on this instance');
		expect(container.textContent).not.toContain('Captured statements');
	});

	it('says the plugin is absent rather than that nothing was slow', () => {
		const { container } = render(QueriesPage, {
			props: props({ gate: { state: 'absent' }, entries: [] }),
		});

		expect(container.textContent).toContain('not part of this build');
	});

	it('names the store when the capture table did not answer', () => {
		const { container } = render(QueriesPage, {
			props: props({ gate: { state: 'capture_store' }, entries: [] }),
		});

		expect(container.textContent).toContain('capture store did not answer');
	});

	// The shared outage state once landed in the capture store warning, which
	// sent the reader to look for a pending migration while the engine was down.
	it('reads an outage as an outage rather than as the capture store', () => {
		const { container } = render(QueriesPage, {
			props: props({ gate: { state: 'unavailable' }, entries: [] }),
		});

		expect(container.textContent).toContain('did not answer');
		expect(container.textContent).not.toContain('capture store');
		expect(container.textContent).toContain('Try again');
	});
});

describe('Slow queries list', () => {
	it('flattens a captured statement onto one line', () => {
		const { container } = render(QueriesPage, {
			props: props({ entries: [entry({ query_text: 'SELECT\n  a\nFROM t' })] }),
		});

		expect(container.textContent).toContain('SELECT a FROM t');
	});

	it('states a slow duration in seconds rather than four digits of milliseconds', () => {
		const { container } = render(QueriesPage, { props: props() });

		expect(container.textContent).toContain('1.40 s');
	});

	it('names the caller the way an editor opens it', () => {
		const { container } = render(QueriesPage, {
			props: props({ entries: [entry({ caller_file: 'store.go', caller_line: 42 })] }),
		});

		expect(container.textContent).toContain('store.go:42');
	});

	it('marks a sequential scan the analyzer found', () => {
		const { container } = render(QueriesPage, {
			props: props({ entries: [entry({ analysis: { has_seq_scan: true } })] }),
		});

		expect(container.textContent).toContain('sequential scan');
	});

	it('reads an empty log as a quiet instance, not a broken one', () => {
		const { container } = render(QueriesPage, { props: props({ entries: [], total: 0 }) });

		expect(container.textContent).toContain('Nothing has been slow');
	});
});

describe('Slow queries analysis', () => {
	it('offers each dialect rather than guessing which one the instance runs', () => {
		const { container } = render(QueriesPage, { props: props() });

		for (const d of ['postgres', 'mysql', 'mssql']) {
			expect(container.textContent, d).toContain(`Analyze ${d}`);
		}
	});

	it('lists a suggestion with the DDL that creates it', () => {
		const { container } = render(QueriesPage, {
			props: props({
				dialect: 'postgres',
				analysis: read([
					entry({
						analysis: {
							index_suggestions: [
								{
									table: 'sys_content',
									columns: ['tenant_id', 'status'],
									reason: 'filtered on both, no index covers them',
									ddl: 'CREATE INDEX ON sys_content (tenant_id, status)',
								},
							],
						},
					}),
				]),
			}),
		});

		expect(container.textContent).toContain('sys_content');
		expect(container.textContent).toContain('CREATE INDEX ON sys_content (tenant_id, status)');
	});

	it('says no plan was read and why, rather than that every plan uses an index', () => {
		const { container } = render(QueriesPage, {
			props: props({ dialect: 'postgres', analysis: read([entry()], 0, 'source_missing') }),
		});

		expect(container.textContent).toContain('No plans were read');
		expect(container.textContent).toContain('pg_stat_statements');
		expect(container.textContent).not.toContain('already');
	});

	it('says how many plans it read when none needs an index', () => {
		const { container } = render(QueriesPage, {
			props: props({ dialect: 'postgres', analysis: read([entry({ plan_text: '[]' })], 1) }),
		});

		expect(container.textContent).toContain('Nothing to suggest in the plan the analyzer read');
	});

	it("lists SQL Server's own missing-index suggestions", () => {
		const { container } = render(QueriesPage, {
			props: props({
				dialect: 'mssql',
				analysis: {
					entries: [],
					missingIndexes: [{ table: 'sys_users', columns: ['email'], reason: 'equality on email' }],
					plansRead: null,
					noPlansReason: null,
				},
			}),
		});

		expect(container.textContent).toContain('sys_users');
		expect(container.textContent).toContain('equality on email');
	});

	it('says the dialect is wrong rather than that there is nothing to suggest', () => {
		// An instance runs one dialect and EXPLAIN is a different grammar in
		// each, so a refusal here is the commonest outcome, not an outage.
		const { container } = render(QueriesPage, {
			props: props({ dialect: 'mssql', analyzeFailed: true }),
		});

		expect(container.textContent).toContain('could not explain these statements as mssql');
		expect(container.textContent).not.toContain('Nothing to suggest');
	});
});

describe('Slow queries filter', () => {
	// The table head and the pager stood above the empty state, so an empty
	// table read as a page of rows that failed to draw.
	it('draws no table or pager when nothing on the page matches', async () => {
		const { container } = render(QueriesPage, { props: props() });
		const input = container.querySelector('#query-narrow') as HTMLInputElement;
		await fireEvent.input(input, { target: { value: 'no such statement' } });

		expect(container.textContent).toContain('Nothing on this page matches');
		expect(container.querySelector('table')).toBeNull();
		expect(container.querySelector('nav[aria-label*="agination" i]')).toBeNull();
	});
});
