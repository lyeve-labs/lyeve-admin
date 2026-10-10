// @vitest-environment jsdom
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/navigation', () => ({
	goto: vi.fn(async () => {}),
	invalidateAll: vi.fn(async () => {}),
}));
vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));

import ObservabilityPage from './+page.svelte';

/**
 * The live tail opens an EventSource as soon as the page mounts and jsdom has
 * none. The stub records its listeners so a log entry can be pushed through the
 * same path the engine's stream uses.
 */
class StubEventSource {
	static last: StubEventSource | null = null;
	static all: StubEventSource[] = [];
	listeners = new Map<string, ((e: MessageEvent) => void)[]>();
	closed = false;

	constructor(public url: string) {
		StubEventSource.last = this;
		StubEventSource.all.push(this);
	}

	addEventListener(type: string, fn: (e: MessageEvent) => void) {
		this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
	}

	emit(type: string, data: unknown) {
		for (const fn of this.listeners.get(type) ?? []) {
			fn({ data: JSON.stringify(data) } as MessageEvent);
		}
	}

	close() {
		this.closed = true;
	}
}

beforeEach(() => {
	StubEventSource.last = null;
	StubEventSource.all = [];
	vi.stubGlobal('EventSource', StubEventSource);
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

const POOL_STATS = {
	max_open_connections: 25,
	open_connections: 8,
	in_use: 3,
	idle: 5,
	wait_count: 0,
	wait_duration: 0,
	max_idle_closed: 0,
	max_idle_time_closed: 0,
	max_lifetime_closed: 0,
};

function data(overrides: Record<string, unknown> = {}) {
	return {
		poolHealth: {
			engine: 'postgres',
			healthy: true,
			pool_stats: POOL_STATS,
			latency: 1200,
			checked_at: '2026-01-01T00:00:00Z',
			errors: [],
			pooler_config: 'pgbouncer',
		},
		latency: { slowest: [], total: 0 },
		top: 20,
		goroutines: 42,
		goroutineEngine: engine(),
		...overrides,
	};
}

const POOL_VIEW = { size: 64, active: 3, waiting: 1, completed: 900, failed: 2, dropped: 0, avg_latency: '1.2ms', task_timeout: '30s' };
const PARALLEL_VIEW = { max_concurrent: 8, timeout: '30s' };
const ASYNC_VIEW = { enabled: true, workers: 4, queue_size: 1024, timeout: '5s', queued: 0, running: 1, overflow: 0, dropped: 0 };
const SNAPSHOT = {
	total: 12,
	runtime_total: 42,
	max_goroutines: 10000,
	leak_threshold: '5m0s',
	by_owner: {
		engine: { total: 4, oldest: '1m2s' },
		'cron': { total: 7, oldest: '3m10s' },
		'email': { total: 1, oldest: '2s' },
	},
};

function engine(over: Record<string, unknown> = {}) {
	return {
		snapshot: SNAPSHOT,
		pool: POOL_VIEW,
		parallel: PARALLEL_VIEW,
		asyncHooks: ASYNC_VIEW,
		byOwner: [
			{ owner: 'cron', total: 7, oldest: '3m10s' },
			{ owner: 'engine', total: 4, oldest: '1m2s' },
			{ owner: 'email', total: 1, oldest: '2s' },
		],
		superAdmin: true,
		licensed: true,
		...over,
	};
}

const props = (over: Record<string, unknown> = {}, form: Record<string, unknown> | null = null) => ({
	data: data(over) as never,
	form: form as never,
});

const health = (over: Record<string, unknown>) => ({
	poolHealth: { engine: 'postgres', healthy: true, ...over },
});

describe('Pool health badge', () => {
	it('reads Healthy when the engine sent the metrics behind the claim', () => {
		const { container } = render(ObservabilityPage, { props: props() });

		expect(container.textContent).toContain('Healthy');
		expect(container.textContent).not.toContain('Health unconfirmed');
	});

	/*
	 * The engine answers `healthy: true` with no pool_stats on a deployment with
	 * no pooler. A Healthy badge over tiles rendering a dash would claim a
	 * measurement nobody took.
	 */
	it('does not claim health it has no metrics for', () => {
		const { container } = render(ObservabilityPage, {
			props: props(health({ healthy: true, checked_at: '2026-01-01T00:00:00Z' })),
		});

		expect(container.textContent).toContain('Health unconfirmed');
		expect(container.textContent).not.toContain('Healthy');
	});

	it('says what is missing instead of rendering a row of dashes', () => {
		const { container } = render(ObservabilityPage, {
			props: props(health({ healthy: true })),
		});

		expect(container.textContent).toContain('no connection statistics');
		expect(container.textContent).not.toContain('Wait count');
	});

	it('still reads Unhealthy when the engine says so, metrics or not', () => {
		const { container } = render(ObservabilityPage, {
			props: props(health({ healthy: false })),
		});

		expect(container.textContent).toContain('Unhealthy');
		expect(container.textContent).not.toContain('Health unconfirmed');
	});

	it('reports the counts when they are there', () => {
		const { container } = render(ObservabilityPage, { props: props() });

		expect(container.textContent).toContain('Wait count');
		expect(container.textContent).toContain('Open');
	});
});

describe('Last checked', () => {
	// An unguarded parse renders the literal string "Invalid Date", which reads
	// as a value the engine sent rather than as one it did not.
	it('never renders the words Invalid Date', () => {
		for (const checked_at of ['', undefined, 'not a timestamp']) {
			cleanup();
			const { container } = render(ObservabilityPage, {
				props: props(health({ checked_at, pool_stats: POOL_STATS })),
			});
			expect(container.textContent, String(checked_at)).not.toContain('Invalid Date');
			expect(container.textContent, String(checked_at)).toContain('No check time reported');
		}
	});

	it('renders the time when the engine reported a readable one', () => {
		const { container } = render(ObservabilityPage, { props: props() });

		expect(container.textContent).toContain('Last checked');
		expect(container.textContent).not.toContain('No check time reported');
	});
});

/*
 * The stream carries slog's severity integer, not the label, so the badge reads
 * the level in either shape.
 */
describe('Live log tail', () => {
	// The tail keys its rows on the sequence, which the engine makes unique.
	let sequence = 0;
	function push(level: number, message = 'a message') {
		StubEventSource.last?.emit('log', {
			timestamp: '2026-01-01T00:00:00Z',
			level,
			message,
			sequence: ++sequence,
		});
	}

	it('renders an entry whose level arrives as an integer', async () => {
		const { container, component } = render(ObservabilityPage, { props: props() });
		void component;

		push(8, 'the database went away');
		await Promise.resolve();

		expect(container.textContent).toContain('the database went away');
	});

	it('names the severity rather than printing the raw integer', async () => {
		const { container } = render(ObservabilityPage, { props: props() });

		push(4, 'slow query');
		await Promise.resolve();

		expect(container.textContent).toContain('WARN');
		expect(container.textContent).not.toContain('>4<');
	});

	it('survives every level the engine emits', async () => {
		const { container } = render(ObservabilityPage, { props: props() });

		for (const level of [-4, 0, 4, 8]) push(level, `entry ${level}`);
		await Promise.resolve();

		for (const label of ['DEBUG', 'INFO', 'WARN', 'ERROR']) {
			expect(container.textContent).toContain(label);
		}
	});
});

/*
 * A filter change is a close followed by a reopen with the new filter in the
 * URL, the keyword waits for the typing to pause, and only unmount stops the
 * reopening. A cleanup that ends the tail for good on a filter change would
 * leave the badge reading Connected over a closed stream.
 */
describe('Live log tail filters', () => {
	const badge = (container: HTMLElement) =>
		[...container.querySelectorAll('span')].find((el) => /^(Connected|Reconnecting)$/.test(el.textContent?.trim() ?? ''))?.textContent?.trim();

	function connect() {
		StubEventSource.last?.emit('open', null);
	}

	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('opens one stream on mount and reads Connected once it opens', async () => {
		const { container } = render(ObservabilityPage, { props: props() });
		expect(StubEventSource.all).toHaveLength(1);
		expect(StubEventSource.last?.url).toBe('/api/admin/logs/stream?min_level=info');
		expect(badge(container)).toBe('Reconnecting');

		connect();
		await tick();
		expect(badge(container)).toBe('Connected');
	});

	it('reopens the stream with the keyword after the typing pauses, not per keystroke', async () => {
		const { container } = render(ObservabilityPage, { props: props() });
		connect();
		await tick();
		const first = StubEventSource.last as StubEventSource;
		const input = container.querySelector('#tail-keyword') as HTMLInputElement;

		for (const typed of ['e', 'er', 'err']) {
			await fireEvent.input(input, { target: { value: typed } });
			vi.advanceTimersByTime(100);
			await tick();
		}
		expect(StubEventSource.all).toHaveLength(1);
		expect(first.closed).toBe(false);

		vi.advanceTimersByTime(300);
		await tick();

		expect(first.closed).toBe(true);
		expect(StubEventSource.all).toHaveLength(2);
		expect(StubEventSource.last?.url).toContain('keyword=err');
		expect(StubEventSource.last?.url).toContain('min_level=info');
		expect(badge(container)).toBe('Reconnecting');

		connect();
		await tick();
		expect(badge(container)).toBe('Connected');
	});

	it('applies the keyword at once on Enter', async () => {
		const { container } = render(ObservabilityPage, { props: props() });
		const first = StubEventSource.last as StubEventSource;
		const input = container.querySelector('#tail-keyword') as HTMLInputElement;

		await fireEvent.input(input, { target: { value: 'timeout' } });
		await fireEvent.keyDown(input, { key: 'Enter' });
		await tick();

		expect(first.closed).toBe(true);
		expect(StubEventSource.all).toHaveLength(2);
		expect(StubEventSource.last?.url).toContain('keyword=timeout');

		// The debounce timer that was pending sets the same value, so it must
		// not open a third stream.
		vi.advanceTimersByTime(300);
		await tick();
		expect(StubEventSource.all).toHaveLength(2);
	});

	it('reopens the stream with the new minimum level on a level pick', async () => {
		const { container } = render(ObservabilityPage, { props: props() });
		connect();
		await tick();
		const first = StubEventSource.last as StubEventSource;

		await fireEvent.click(container.querySelector('#tail-level') as HTMLElement);
		await tick();
		const option = [...document.querySelectorAll('[role="option"]')].find((el) => el.textContent?.trim() === 'ERROR');
		expect(option).toBeTruthy();
		await fireEvent.click(option as HTMLElement);
		await tick();

		expect(first.closed).toBe(true);
		expect(StubEventSource.all).toHaveLength(2);
		expect(StubEventSource.last?.url).toBe('/api/admin/logs/stream?min_level=error');
		expect(badge(container)).toBe('Reconnecting');

		// Lines keep arriving on the new stream.
		connect();
		StubEventSource.last?.emit('log', { timestamp: '2026-01-01T00:00:00Z', level: 8, message: 'after the pick', sequence: 1 });
		await tick();
		expect(badge(container)).toBe('Connected');
		expect(container.textContent).toContain('after the pick');
	});

	it('closes the stream on unmount and does not reopen it', async () => {
		const { unmount } = render(ObservabilityPage, { props: props() });
		connect();
		await tick();
		const first = StubEventSource.last as StubEventSource;

		unmount();
		await tick();
		vi.advanceTimersByTime(5000);
		await tick();

		expect(first.closed).toBe(true);
		expect(StubEventSource.all).toHaveLength(1);
	});

	it('retries after a dropped stream, but not after unmount', async () => {
		const { unmount } = render(ObservabilityPage, { props: props() });
		const first = StubEventSource.last as StubEventSource;

		first.emit('error', null);
		await tick();
		expect(first.closed).toBe(true);
		vi.advanceTimersByTime(3000);
		await tick();
		expect(StubEventSource.all).toHaveLength(2);

		(StubEventSource.last as StubEventSource).emit('error', null);
		unmount();
		vi.advanceTimersByTime(3000);
		await tick();
		expect(StubEventSource.all).toHaveLength(2);
	});
});

/*
 * The pool's state is a badge on its card, the figures are one row,
 * the rankings table is the body with its row count in the toolbar, and there
 * is one refresh for the page.
 */
describe('Page shape', () => {
	it('opens without a banner, and says an unconfirmed pool on the card badge', () => {
		const { container } = render(ObservabilityPage, {
			props: props(health({ healthy: true })),
		});
		expect(container.querySelector('[role="alert"], [role="status"]')).toBeNull();
		const badge = [...container.querySelectorAll('span')].find((el) => el.textContent?.trim() === 'Health unconfirmed');
		expect(badge, 'no badge').toBeTruthy();
		const header = badge!.closest('div');
		expect(header?.querySelector('h2')?.textContent).toContain('Connection pool');
	});

	it('puts the engine, the ping latency, the goroutines and the pool counts on one row', () => {
		const { container } = render(ObservabilityPage, { props: props() });
		const row = container.querySelector('[data-testid="pool-stats"]') as HTMLElement;
		for (const label of ['Engine', 'Ping latency', 'Goroutines', 'Open', 'In use', 'Idle', 'Wait count']) {
			expect(row.textContent, label).toContain(label);
		}
		expect(row.textContent).toContain('42');
	});

	it('offers one refresh for the page, in the header', () => {
		const { getAllByRole } = render(ObservabilityPage, { props: props() });
		expect(getAllByRole('button', { name: /refresh/i })).toHaveLength(1);
	});

	it('keeps the row count in the rankings toolbar', () => {
		const { container } = render(ObservabilityPage, { props: props({ latency: { slowest: [], total: 7 } }) });
		const bar = [...container.querySelectorAll('[role="toolbar"]')].find((el) => el.getAttribute('aria-label') === 'Latency rankings');
		expect(bar?.querySelector('#latency-top')).toBeTruthy();
		expect(bar?.textContent).toContain('7 endpoints tracked');
	});
});

/*
 * The engine's scaling primitives are one section: the four views as tiles,
 * the tracked goroutines by owner, and the three tunables as forms. The views
 * are readable on every install. The forms need super_admin and nothing else,
 * and say so instead of failing.
 */
describe('Goroutine engine', () => {
	const section = (container: HTMLElement) => container.querySelector('[data-testid="goroutine-engine"]') as HTMLElement;
	const fieldsets = (container: HTMLElement) => [...section(container).querySelectorAll('fieldset')] as HTMLFieldSetElement[];

	it('wears the Beta badge and renders the four views as tiles', () => {
		const { container } = render(ObservabilityPage, { props: props() });
		const el = section(container);
		expect(el.querySelector('h2')?.textContent).toContain('Goroutine engine');
		expect([...el.querySelectorAll('span')].some((s) => s.textContent?.trim() === 'Beta')).toBe(true);

		const views = el.querySelector('[data-testid="goroutine-views"]') as HTMLElement;
		for (const label of ['Tracked', 'Runtime', 'Ceiling', 'Leak threshold', 'Size', 'Active', 'Waiting', 'Completed', 'Failed', 'Dropped', 'Avg latency', 'Task timeout', 'Max concurrent', 'Enabled', 'Workers', 'Queue size', 'Queued', 'Running', 'Overflow']) {
			expect(views.textContent, label).toContain(label);
		}
		for (const value of ['10000', '5m', '64', '900', '1.2 ms', '1024', 'On']) {
			expect(views.textContent, value).toContain(value);
		}
	});

	it('lists the owners with the largest first', () => {
		const { container } = render(ObservabilityPage, { props: props() });
		const rows = [...section(container).querySelectorAll('[data-testid="goroutine-owners"] tbody tr')];
		expect(rows.map((r) => r.querySelector('td')?.textContent?.trim())).toEqual(['cron', 'engine', 'email']);
		expect(rows[0].textContent).toContain('7');
		expect(rows[0].textContent).toContain('3m10s');
	});

	it('says when nothing is tracked instead of an empty table', () => {
		const { container } = render(ObservabilityPage, {
			props: props({ goroutineEngine: engine({ snapshot: { total: 3, runtime_total: 3 }, byOwner: [] }) }),
		});
		expect(section(container).querySelector('[data-testid="goroutine-owners"]')).toBeNull();
		expect(section(container).textContent).toContain('No tracked goroutine has an owner yet');
	});

	it('opens the forms on the live values and enables them for a super admin', () => {
		const { container } = render(ObservabilityPage, { props: props() });
		expect(fieldsets(container)).toHaveLength(3);
		for (const fs of fieldsets(container)) expect(fs.disabled).toBe(false);
		expect((container.querySelector('input[name="size"]') as HTMLInputElement).value).toBe('64');
		expect((container.querySelector('input[name="max_concurrent"]') as HTMLInputElement).value).toBe('8');
		expect((container.querySelector('input[name="timeout"]') as HTMLInputElement).value).toBe('30s');
		expect((container.querySelector('input[name="workers"]') as HTMLInputElement).value).toBe('4');
		expect((container.querySelector('input[name="queue_size"]') as HTMLInputElement).value).toBe('1024');
		expect((container.querySelector('input[name="enabled"]') as HTMLInputElement).checked).toBe(true);
		expect(section(container).querySelector('[data-testid="not-enabled"]')).toBeNull();
		expect(section(container).querySelector('[data-testid="goroutine-license-note"]')).toBeNull();
	});

	// The role and the plugin's tuning flag disable a form. Neither draws the
	// generic not-enabled notice.
	it('draws no not-enabled notice in this section for either role', () => {
		for (const superAdmin of [true, false]) {
			const { container } = render(ObservabilityPage, {
				props: props({ goroutineEngine: engine({ superAdmin }) }),
			});
			expect(section(container).querySelector('[data-testid="not-enabled"]')).toBeNull();
		}
	});

	it('disables the forms for an admin who is not super admin, with the reason', () => {
		const { container } = render(ObservabilityPage, {
			props: props({ goroutineEngine: engine({ superAdmin: false }) }),
		});
		for (const fs of fieldsets(container)) expect(fs.disabled).toBe(true);
		expect(section(container).querySelector('[data-testid="goroutine-role-note"]')?.textContent).toContain('super admin');
		// The views stay: the reads are not gated.
		expect(section(container).querySelector('[data-testid="goroutine-views"]')?.textContent).toContain('Tracked');
	});

	it('disables the forms for a super admin when tuning is not licensed, with the reason', () => {
		const { container } = render(ObservabilityPage, {
			props: props({ goroutineEngine: engine({ licensed: false }) }),
		});
		expect(fieldsets(container)).toHaveLength(3);
		for (const fs of fieldsets(container)) expect(fs.disabled).toBe(true);
		const note = section(container).querySelector('[data-testid="goroutine-license-note"]') as HTMLElement;
		expect(note.textContent).toContain('Changing these settings on a running server needs a license that includes tuning.');
		expect(note.querySelector('a')?.getAttribute('href')).toBe('/admin/settings/license');
		expect(section(container).querySelector('[data-testid="goroutine-role-note"]')).toBeNull();
		// Every reading stays: only the writes are licensed.
		const views = section(container).querySelector('[data-testid="goroutine-views"]') as HTMLElement;
		for (const label of ['Tracked', 'Size', 'Max concurrent', 'Workers']) expect(views.textContent, label).toContain(label);
		expect((container.querySelector('input[name="size"]') as HTMLInputElement).value).toBe('64');
	});

	it('states both reasons when the session is not super admin and tuning is not licensed', () => {
		const { container } = render(ObservabilityPage, {
			props: props({ goroutineEngine: engine({ superAdmin: false, licensed: false }) }),
		});
		for (const fs of fieldsets(container)) expect(fs.disabled).toBe(true);
		expect(section(container).querySelector('[data-testid="goroutine-role-note"]')).not.toBeNull();
		expect(section(container).querySelector('[data-testid="goroutine-license-note"]')).not.toBeNull();
	});

	it('renders a 402 as the license refusal on the form that asked, not as an error', () => {
		const { container } = render(ObservabilityPage, {
			props: props({}, { form: 'pool', refused: { kind: 'feature', feature: 'example-feature', plugin: 'example', upgradeUrl: '' } }),
		});
		const forms = [...section(container).querySelectorAll('form')];
		const notice = forms[0].querySelector('[data-testid="refusal-notice"]') as HTMLElement;
		expect(notice.textContent).toContain('This needs example-feature');
		expect(notice.textContent).toContain('Nothing was changed.');
		expect(forms[0].querySelector('[role="alert"]')?.textContent ?? '').not.toContain('Failed to');
		expect(forms[1].querySelector('[data-testid="refusal-notice"]')).toBeNull();
		expect(forms[2].querySelector('[data-testid="refusal-notice"]')).toBeNull();
	});

	it('renders a refusal inline on the form that asked, and nowhere else', () => {
		const { container } = render(ObservabilityPage, {
			props: props({}, { form: 'parallel', error: 'Failed to reconfigure the parallel engine.' }),
		});
		const forms = [...section(container).querySelectorAll('form')];
		expect(forms).toHaveLength(3);
		expect(forms[1].textContent).toContain('Failed to reconfigure');
		expect(forms[0].textContent).not.toContain('Failed to');
		expect(forms[2].textContent).not.toContain('Failed to');
	});

	it('renders a 422 inline with the plugin bounds message', () => {
		const { container } = render(ObservabilityPage, {
			props: props({}, { form: 'pool', error: 'pool size must be between 1 and 4096' }),
		});
		const forms = [...section(container).querySelectorAll('form')];
		expect(forms[0].querySelector('[role="alert"]')?.textContent).toContain('between 1 and 4096');
	});

	it('reports a save on the form that made it', () => {
		const { container } = render(ObservabilityPage, {
			props: props({}, { form: 'asyncHooks', saved: true, view: ASYNC_VIEW }),
		});
		const forms = [...section(container).querySelectorAll('form')];
		expect(forms[2].textContent).toContain('Applied');
		expect(forms[0].textContent).not.toContain('Applied');
	});

	it('says the engine did not answer instead of drawing empty tiles', () => {
		const { container } = render(ObservabilityPage, {
			props: props({ goroutineEngine: engine({ snapshot: null, pool: null, parallel: null, asyncHooks: null, byOwner: [] }) }),
		});
		expect(section(container).textContent).toContain('Goroutine engine unavailable');
		expect(section(container).querySelector('form')).toBeNull();
	});
});
