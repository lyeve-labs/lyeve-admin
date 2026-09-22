// @vitest-environment jsdom
import { render, cleanup } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/navigation', () => ({ invalidateAll: vi.fn(async () => {}) }));
vi.mock('$app/forms', () => ({ enhance: () => ({ destroy: () => {} }) }));

import EventsPage from './+page.svelte';
import type { EventRow, ReplayRun } from '$lib/api/events';

afterEach(cleanup);

function said(container: HTMLElement): string {
	return (container.textContent ?? '').replace(/\s+/g, ' ');
}

function row(over: Partial<EventRow> = {}): EventRow {
	return {
		id: 'e1',
		source: 'content',
		topic: 'content.created',
		schema_name: 'article',
		event_type: 'created',
		published_at: '2026-09-22T10:00:00Z',
		tenant_id: 't1',
		...over,
	};
}

function run(over: Partial<ReplayRun> = {}): ReplayRun {
	return {
		run_id: 'r1',
		status: 'completed',
		handler: 'webhook',
		since: '2026-09-22T09:00:00Z',
		dry_run: false,
		tenant_id: 't1',
		total_events: 4,
		replayed: 4,
		skipped: 0,
		failed: 0,
		started_at: '2026-09-22T10:00:00Z',
		...over,
	};
}

const props = (over: Record<string, unknown> = {}, form: unknown = null) => ({
	data: {
		events: [row()],
		runs: [],
		total: 1,
		limit: 50,
		offset: 0,
		gate: { state: 'ok' },
		licensed: true,
		...over,
	} as never,
	form: form as never,
});

describe('Events gate', () => {
	it('shows the not-enabled state when the engine refuses the routes', () => {
		const { container } = render(EventsPage, { props: props({ gate: { state: 'locked', upgradeUrl: '' } }) });
		expect(said(container)).toContain('Not enabled on this instance');
		expect(said(container)).not.toContain('Published');
	});

	it('says the plugin is absent rather than that nothing was published', () => {
		const { container } = render(EventsPage, {
			props: props({ gate: { state: 'absent' }, events: [] }),
		});
		expect(said(container)).toContain('not part of this build');
	});
});

describe('Events replay', () => {
	// A replay posts every event in the window to its handler again and
	// nothing undoes that, so the destructive option is never the default.
	it('rehearses by default', () => {
		const { container } = render(EventsPage, { props: props() });
		expect(said(container)).toContain('Rehearse');
		expect(container.querySelector('input[name="dry_run"]')).toHaveProperty('value', 'true');
	});

	it('warns that a real replay cannot be taken back', () => {
		const { container } = render(EventsPage, { props: props() });
		expect(said(container)).toContain('nothing undoes that');
	});

	it('says plainly that a rehearsal posted nothing', () => {
		const { container } = render(EventsPage, {
			props: props({}, { started: 'r9', dryRun: true }),
		});
		expect(said(container)).toContain('Nothing was posted to a handler');
	});

	it('marks a rehearsal in the run list so its counts are not misread', () => {
		const { container } = render(EventsPage, {
			props: props({ runs: [run({ dry_run: true, replayed: 400 })] }),
		});
		expect(said(container)).toContain('rehearsal');
		expect(said(container)).toContain('nothing was posted');
	});

	it('states progress against the total rather than the replayed count alone', () => {
		const { container } = render(EventsPage, {
			props: props({ runs: [run({ status: 'running', replayed: 1, skipped: 1, total_events: 4 })] }),
		});
		expect(said(container)).toContain('50% of 4');
	});
});

describe('Events log', () => {
	it('reads an empty log as a quiet instance', () => {
		const { container } = render(EventsPage, { props: props({ events: [], total: 0 }) });
		expect(said(container)).toContain('quiet instance');
	});

	it('marks an event that carries an error, which is why anyone replays', () => {
		const { container } = render(EventsPage, {
			props: props({ events: [row({ error: 'handler timed out' })] }),
		});
		expect(said(container)).toContain('error');
	});

	it('counts the failures separately from the total', () => {
		const { container } = render(EventsPage, {
			props: props({ events: [row(), row({ id: 'e2', error: 'boom' })], total: 2 }),
		});
		expect(said(container)).toContain('Carrying an error');
	});
});
