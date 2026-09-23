// @vitest-environment jsdom
import { render, cleanup } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/navigation', () => ({ invalidate: vi.fn(async () => {}), goto: vi.fn(async () => {}) }));
vi.mock('$app/forms', () => ({ enhance: () => ({ destroy: () => {} }) }));
vi.mock('$app/state', () => ({ page: { url: new URL('http://localhost/admin/imports') } }));

import ImportsPage from './+page.svelte';
import type { ImportJob } from '$lib/api/bulk-import';

afterEach(cleanup);

function said(c: HTMLElement): string {
	return (c.textContent ?? '').replace(/\s+/g, ' ');
}

function job(over: Partial<ImportJob> = {}): ImportJob {
	return {
		id: 'j1',
		content_type: 'article',
		source_format: 'csv',
		source_name: 'articles.csv',
		source_kind: 'upload',
		mode: 'create',
		total_rows: 10,
		processed_rows: 10,
		errored_rows: 0,
		inserted_rows: 10,
		updated_rows: 0,
		skipped_rows: 0,
		status: 'completed',
		dry_run: false,
		created_at: '2026-09-26T10:00:00Z',
		...over,
	};
}

const props = (over: Record<string, unknown> = {}) => ({
	data: {
		jobs: [job()],
		total: 1,
		limit: 25,
		offset: 0,
		hasMore: false,
		gate: { state: 'ok' },
		installed: true,
		schemas: [{ name: 'article', fields: [{ name: 'title', field_type: 'text' }] }],
		detail: null,
		...over,
	} as never,
	form: null as never,
});

describe('Imports', () => {
	it('explains the concept and names the sources before anything has run', () => {
		const { container } = render(ImportsPage, { props: props({ jobs: [], total: 0 }) });
		const text = said(container);
		expect(text).toContain('How an import works');
		expect(text).toContain('A dry run comes first');
		expect(text).toContain('File upload');
		expect(text).toContain('Web address');
		expect(text).toContain('Another LyEve instance');
		expect(text).toContain('Nothing has been imported');
	});

	it('offers the rejected rows for download only where rows were rejected', () => {
		const clean = render(ImportsPage, { props: props() });
		expect(clean.container.querySelector('[aria-label^="Download the rows rejected"]')).toBeNull();
		cleanup();

		const partial = render(ImportsPage, {
			props: props({ jobs: [job({ status: 'completed_with_errors', errored_rows: 3, inserted_rows: 7 })] }),
		});
		const link = partial.container.querySelector('[aria-label^="Download the rows rejected"]');
		expect(link?.getAttribute('href')).toBe('/api/admin/imports/j1/rejected');
		expect(said(partial.container)).toContain('Finished with rows rejected');
	});

	it('follows a running import with its row count', () => {
		const { container } = render(ImportsPage, {
			props: props({ jobs: [job({ status: 'running', processed_rows: 400, total_rows: 1000 })] }),
		});
		expect(said(container)).toContain('400 of 1,000 rows');
		expect(said(container)).toContain('One import is running');
	});

	it('marks a dry run as having written nothing', () => {
		const { container } = render(ImportsPage, { props: props({ jobs: [job({ dry_run: true })] }) });
		expect(said(container)).toContain('Dry run, nothing written');
	});
});
