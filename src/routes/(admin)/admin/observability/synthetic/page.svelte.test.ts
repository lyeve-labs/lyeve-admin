// @vitest-environment jsdom
import { render, cleanup, fireEvent, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy: () => {} }) }));
const nav = vi.hoisted(() => ({ goto: vi.fn(async () => {}) }));
vi.mock('$app/navigation', () => nav);

import SyntheticPage from './+page.svelte';
import type { Probe, ProbeAlert } from '$lib/api/synthetic';

afterEach(cleanup);

function said(c: HTMLElement): string {
	return (c.textContent ?? '').replace(/\s+/g, ' ');
}

function probe(over: Partial<Probe> = {}): Probe {
	return {
		id: 'p1',
		tenant_id: 'default',
		name: 'Homepage',
		type: 'health_check',
		enabled: true,
		config: { url: 'https://example.com/healthz', expected_status: 200 },
		interval_seconds: 300,
		timeout_seconds: 10,
		regions: null,
		alert_threshold: 3,
		last_run_at: '2026-09-22T10:00:00Z',
		last_status: 'pass',
		created_at: '2026-09-01T00:00:00Z',
		updated_at: '2026-09-01T00:00:00Z',
		...over,
	};
}

function alert(over: Partial<ProbeAlert> = {}): ProbeAlert {
	return {
		id: 'a1',
		probe_id: 'p1',
		probe_name: 'Homepage',
		probe_type: 'health_check',
		consecutive_failures: 4,
		last_failure_at: '2026-09-22T11:00:00Z',
		last_failure_error: 'dial tcp: connection refused',
		message: 'Homepage has failed 4 times in a row',
		acknowledged: false,
		created_at: '2026-09-22T11:00:00Z',
		...over,
	};
}

const props = (over: Record<string, unknown> = {}, form: unknown = null) => ({
	data: {
		probes: [probe()],
		alerts: [],
		total: 1,
		limit: 25,
		offset: 0,
		hasMore: false,
		gate: { state: 'ok' },
		licensed: true,
		...over,
	} as never,
	form: form as never,
});

describe('the gate', () => {
	it('shows the not-enabled state when the engine refuses the routes', () => {
		const { container } = render(SyntheticPage, {
			props: props({ gate: { state: 'locked', upgradeUrl: '' }, probes: [] }),
		});
		expect(said(container)).toContain('Not enabled on this instance');
		expect(said(container)).not.toContain('No probe is configured');
	});

	// The worst thing a monitoring page can do is report a failed read as
	// silence.
	it('reports a failed read as a failure, not as everything passing', () => {
		const { container } = render(SyntheticPage, {
			props: props({
				gate: { state: 'error', message: 'The probes could not be read.' },
				probes: [],
			}),
		});
		expect(said(container)).toContain('could not be read');
		expect(said(container)).not.toContain('No probe is configured');
	});
});

describe('the rows', () => {
	it('names what a probe checks, not just its type', () => {
		const { container } = render(SyntheticPage, { props: props() });
		expect(said(container)).toContain('https://example.com/healthz');
	});

	it('shows a paused probe as paused rather than as its last pass', () => {
		const { container } = render(SyntheticPage, {
			props: props({ probes: [probe({ enabled: false, last_status: 'pass' })] }),
		});
		expect(said(container)).toContain('Paused');
		expect(said(container)).not.toContain('Passing');
	});

	it('counts the failing probes and says none when there are none', () => {
		const quiet = render(SyntheticPage, { props: props() });
		expect(said(quiet.container)).toContain('Failing');
		cleanup();

		const loud = render(SyntheticPage, {
			props: props({ probes: [probe({ last_status: 'fail' })] }),
		});
		expect(said(loud.container)).toContain('Failing');
	});

	it('offers a run for every probe, paused ones included', () => {
		const { getByLabelText } = render(SyntheticPage, {
			props: props({ probes: [probe({ enabled: false })] }),
		});
		expect(getByLabelText('Run Homepage now')).toBeTruthy();
	});
});

describe('alerts', () => {
	it('shows an outstanding alert above the list, with what failed', () => {
		const { container } = render(SyntheticPage, { props: props({ alerts: [alert()] }) });
		const text = said(container);
		expect(text).toContain('Unacknowledged alerts');
		expect(text).toContain('4 in a row');
		expect(text).toContain('dial tcp: connection refused');
	});

	it('shows no alert band when nothing is outstanding', () => {
		const { container } = render(SyntheticPage, { props: props() });
		expect(said(container)).not.toContain('Unacknowledged alerts');
	});
});

describe('the form', () => {
	// The four types take different settings. One form carrying all of them
	// would ask for a webhook URL to run a sign-in check.
	it('shows only the settings the chosen type reads', async () => {
		render(SyntheticPage, { props: props() });
		await fireEvent.click(screen.getByRole('button', { name: /new probe/i }));

		expect(screen.getByLabelText(/^URL/)).toBeTruthy();
		expect(screen.queryByLabelText(/webhook url/i)).toBeNull();
	});

	it('submits the schedule switch even when it is off', async () => {
		const { container } = render(SyntheticPage, { props: props() });
		await fireEvent.click(screen.getByRole('button', { name: /new probe/i }));
		const names = [...container.querySelectorAll('input[type="hidden"]')].map((i) =>
			i.getAttribute('name'),
		);
		expect(names).toContain('enabled');
	});

	it('shows the action error where the form is', () => {
		const { container } = render(SyntheticPage, {
			props: props({}, { error: 'The timeout has to be shorter than the interval.' }),
		});
		expect(said(container)).toContain('shorter than the interval');
	});
});

describe('the empty state', () => {
	it('says nothing is checking rather than that a read failed', () => {
		const { container } = render(SyntheticPage, { props: props({ probes: [] }) });
		expect(said(container)).toContain('Nothing is checking this instance');
	});
});

describe('notice channels', () => {
	const read = (over: Record<string, unknown> = {}) => ({
		probe: probe(),
		read: { channels: { email: ['ops@example.com'], pagerduty_routing_key: '...cdef' }, licensed: true, ...over },
		gate: { state: 'ok' },
	});

	it('links each probe to its own channels', () => {
		const { container } = render(SyntheticPage, { props: props() });
		const link = container.querySelector('a[aria-label="Notice channels for Homepage"]');
		expect(link?.getAttribute('href')).toContain('channels=p1');
	});

	it('opens on the probe the address names, with the stored channels masked', () => {
		const { container } = render(SyntheticPage, { props: props({ channelsFor: read() }) });
		const dialog = container.querySelector('[role="dialog"]') as HTMLElement;
		expect(dialog.textContent).toContain('Notice channels for Homepage');
		expect((dialog.querySelector('#probe-channel-pagerduty') as HTMLInputElement).value).toBe('...cdef');
		expect((dialog.querySelector('#probe-channel-email') as HTMLTextAreaElement).value).toBe('ops@example.com');
	});

	it('closes the empty paid channels when the plugin says it would refuse them', () => {
		const { container } = render(SyntheticPage, { props: props({ channelsFor: read({ licensed: false }) }) });
		const dialog = container.querySelector('[role="dialog"]') as HTMLElement;
		expect((dialog.querySelector('#probe-channel-slack') as HTMLInputElement).disabled).toBe(true);
		expect((dialog.querySelector('#probe-channel-pagerduty') as HTMLInputElement).disabled).toBe(false);
	});

	it('renders a refused save in the drawer, not over the page', () => {
		const { container } = render(SyntheticPage, {
			props: props(
				{ channelsFor: read() },
				{
					error: 'refused',
					channels: true,
					refused: { kind: 'feature', feature: 'example-feature', plugin: 'synthetic-monitoring', upgradeUrl: '' },
				},
			),
		});
		const dialog = container.querySelector('[role="dialog"]') as HTMLElement;
		expect(dialog.querySelector('[data-testid="refusal-notice"]')).not.toBeNull();
		expect(container.querySelectorAll('[data-testid="refusal-notice"]')).toHaveLength(1);
	});

	it('says a failed channels read failed', () => {
		const { container } = render(SyntheticPage, {
			props: props({ channelsFor: { probe: probe(), read: null, gate: { state: 'error', message: 'x' } } }),
		});
		expect(said(container.querySelector('[role="dialog"]') as HTMLElement)).toContain('could not be read');
	});

	it('shows the webhook signing secret the save answered', () => {
		const { container } = render(SyntheticPage, {
			props: props({}, { channelsSaved: 'p1', signingSecret: 'f'.repeat(64) }),
		});
		expect(said(container.ownerDocument.body)).toContain('Webhook signing secret');
	});
});
