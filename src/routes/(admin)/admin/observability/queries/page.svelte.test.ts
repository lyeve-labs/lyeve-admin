// @vitest-environment jsdom
import { render, cleanup } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/navigation', () => ({
	goto: vi.fn(async () => {}),
	invalidateAll: vi.fn(async () => {}),
}));

import QueriesPage from './+page.svelte';
import type { QueryLogEntry } from '$lib/api/query-monitor';

afterEach(cleanup);

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
		analyzed: [],
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
			props: props({ gate: { state: 'unavailable' }, entries: [] }),
		});

		expect(container.textContent).toContain('capture store did not answer');
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
				analyzed: [
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
				],
			}),
		});

		expect(container.textContent).toContain('sys_content');
		expect(container.textContent).toContain('CREATE INDEX ON sys_content (tenant_id, status)');
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
