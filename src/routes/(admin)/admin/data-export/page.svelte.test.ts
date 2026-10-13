// @vitest-environment jsdom
import { render, cleanup } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/navigation', () => ({ invalidateAll: vi.fn(async () => {}), invalidate: vi.fn(async () => {}) }));
vi.mock('$app/forms', () => ({ enhance: () => ({ destroy: () => {} }) }));

import ExportPage from './+page.svelte';
import type { ExportJob, ExportSchedule } from '$lib/api/data-export';

afterEach(cleanup);

function said(c: HTMLElement): string {
	return (c.textContent ?? '').replace(/\s+/g, ' ');
}

function job(over: Partial<ExportJob> = {}): ExportJob {
	return {
		id: 'j1',
		name: 'nightly',
		format: 'json',
		status: 'completed',
		filter: {},
		include_media: false,
		rows_processed: 10,
		rows_total: 10,
		file_key: 'exports/j1.json',
		file_size: 2048,
		rows_written: 10,
		created_at: '2026-09-22T10:00:00Z',
		...over,
	};
}

function schedule(over: Partial<ExportSchedule> = {}): ExportSchedule {
	return {
		id: 's1',
		name: 'nightly',
		enabled: true,
		cron_expression: '0 2 * * *',
		next_run_at: '2026-09-23T02:00:00Z',
		created_at: '2026-09-22T10:00:00Z',
		...over,
	};
}

// A list passed as a plain array is a read that answered. A case passes the
// failed read itself to draw the page without one.
const answered = (value: unknown) => (Array.isArray(value) ? { ok: true, value } : value);

const props = (over: Record<string, unknown> = {}, form: unknown = null) => {
	const data: Record<string, unknown> = {
		jobs: [job()],
		schedules: [],
		total: 1,
		limit: 50,
		offset: 0,
		gate: { state: 'ok' },
		licensed: true,
		schemas: ['article', 'page'],
		...over,
	};
	data.schedules = answered(data.schedules);
	data.schemas = answered(data.schemas);
	return { data: data as never, form: form as never };
};

describe('Data export gate', () => {
	it('shows the not-enabled state when the engine refuses the routes', () => {
		const { container } = render(ExportPage, { props: props({ gate: { state: 'locked', upgradeUrl: '' } }) });
		expect(said(container)).toContain('Not enabled on this instance');
		expect(said(container)).not.toContain('Start an export');
	});

	it('says the plugin is absent rather than that nothing was exported', () => {
		const { container } = render(ExportPage, {
			props: props({ gate: { state: 'absent' }, jobs: [] }),
		});
		expect(said(container)).toContain('not part of this build');
	});
});

describe('Data export jobs', () => {
	it('offers a download only when the file is still there', () => {
		// A completed job that wrote no file has nothing to serve, so the
		// link would 404.
		const { container } = render(ExportPage, {
			props: props({ jobs: [job({ file_key: undefined })] }),
		});
		expect(container.querySelector('[aria-label^="Download "]')).toBeNull();
	});

	it('offers a download for a finished job that wrote one', () => {
		const { container } = render(ExportPage, { props: props() });
		expect(container.querySelector('[aria-label="Download nightly"]')).not.toBeNull();
	});

	it('offers cancel only while a job can still be stopped', () => {
		const { container } = render(ExportPage, { props: props() });
		expect(container.querySelector('[aria-label^="Cancel "]')).toBeNull();

		const running = render(ExportPage, { props: props({ jobs: [job({ status: 'running' })] }) });
		expect(running.container.querySelector('[aria-label="Cancel nightly"]')).not.toBeNull();
	});

	it('states a size a person can read', () => {
		const { container } = render(ExportPage, { props: props() });
		expect(said(container)).toContain('2.0 KB');
	});

	it('names the error on a failed job rather than only the status', () => {
		const { container } = render(ExportPage, {
			props: props({ jobs: [job({ status: 'failed', error: 'storage refused the write' })] }),
		});
		expect(said(container)).toContain('storage refused the write');
	});

	it('reads an empty list as nothing exported yet', () => {
		const { container } = render(ExportPage, { props: props({ jobs: [], total: 0 }) });
		expect(said(container)).toContain('Nothing has been exported');
	});
});

describe('Data export schedules', () => {
	it('keeps schedules apart from jobs, so a paused one is not a failed export', () => {
		const { container } = render(ExportPage, {
			props: props({ schedules: [schedule({ enabled: false })] }),
		});
		expect(said(container)).toContain('Paused');
		expect(said(container)).toContain('Schedules');
	});

	it('shows no next run for a schedule that is switched off', () => {
		// The row keeps its next_run_at while paused, and printing it would
		// promise a run that will not happen.
		const { container } = render(ExportPage, {
			props: props({ schedules: [schedule({ enabled: false })] }),
		});
		expect(said(container)).not.toContain('2026-09-23');
	});

	it('says plainly when nothing recurring is configured', () => {
		const { container } = render(ExportPage, { props: props() });
		expect(said(container)).toContain('No recurring export');
	});
});

describe('Data export while a job runs', () => {
	it('says which step a running export is on and how far the writing got', () => {
		const { container } = render(ExportPage, {
			props: props({
				jobs: [job({ status: 'running', stage: 'writing', rows_processed: 340, rows_total: 1200 })],
			}),
		});
		expect(said(container)).toContain('Writing 340 of 1,200 entries');
		expect(said(container)).toContain('One export is running');
		expect(container.querySelector('[role="progressbar"]')).not.toBeNull();
	});

	it('says where a failed export stopped beside its reason', () => {
		const { container } = render(ExportPage, {
			props: props({ jobs: [job({ status: 'failed', stage: 'storing', error: 'storage put: disk full' })] }),
		});
		expect(said(container)).toContain('Failed while storing the file');
		expect(said(container)).toContain('storage put: disk full');
	});
});

/*
 * A schedule list that could not be read is not a report that nothing
 * recurs. Drawn as one, an operator would create a second nightly export
 * beside the one that is already running.
 */
describe('Data export panels that could not be read', () => {
	const failed = { ok: false, gate: { state: 'error', message: 'The schedules could not be read. This is not a report that there are none.' } };

	it('says the schedules could not be read instead of that there are none', () => {
		const { container } = render(ExportPage, { props: props({ schedules: failed }) });
		expect(said(container)).toContain('The schedules could not be read');
		expect(said(container)).not.toContain('No recurring export');
	});

	it('offers no new schedule while the list is unread', () => {
		const { queryByRole } = render(ExportPage, { props: props({ schedules: failed }) });
		expect(queryByRole('button', { name: /new schedule/i })).toBeNull();
	});
});
