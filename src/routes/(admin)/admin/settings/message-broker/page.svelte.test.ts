// @vitest-environment jsdom
import { render, cleanup } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/navigation', () => ({ invalidateAll: vi.fn(async () => {}) }));

import BrokerPage from './+page.svelte';
import type { BrokerStatus } from '$lib/api/messagebroker';

afterEach(cleanup);

function said(c: HTMLElement): string {
	return (c.textContent ?? '').replace(/\s+/g, ' ');
}

function status(over: Partial<BrokerStatus> = {}): BrokerStatus {
	return {
		backend: 'nats',
		connected: true,
		degraded: false,
		target: 'nats://broker.example.com:4222',
		stream: 'LYEVE',
		tls: true,
		published: 100,
		failed: 0,
		dropped: 0,
		last_publish_at: '2026-09-22T10:00:00Z',
		...over,
	};
}

const props = (over: Record<string, unknown> = {}) => ({
	data: {
		status: status(),
		gate: { state: 'ok' },
		licensed: true,
		permitted: true,
		...over,
	} as never,
});

describe('the gate', () => {
	it('shows the not-enabled state when the engine refuses the routes', () => {
		const { container } = render(BrokerPage, {
			props: props({ gate: { state: 'locked', upgradeUrl: '' }, status: null }),
		});
		expect(said(container)).toContain('Not enabled on this instance');
	});

	it('explains the refusal to an admin who may not read it', () => {
		const { container } = render(BrokerPage, {
			props: props({ permitted: false, status: null }),
		});
		expect(said(container)).toContain("super admin's to read");
	});

	// The worst thing this page can do is report a failed read as a working
	// broker, which is exactly what the operator came to check.
	it('reports a failed read as a failure, not as a healthy broker', () => {
		const { container } = render(BrokerPage, {
			props: props({ gate: { state: 'error', message: 'The broker status could not be read.' }, status: null }),
		});
		expect(said(container)).toContain('could not be read');
		expect(said(container)).not.toContain('Publishing');
	});
});

describe('what the numbers mean', () => {
	// Publishing is fire and forget, so nothing else in the product reported
	// these failures. The page has to say that, or the reader assumes an alert
	// would have fired.
	it('says a refusal went unreported everywhere else', () => {
		const { container } = render(BrokerPage, {
			props: props({ status: status({ failed: 12 }) }),
		});
		const text = said(container);
		expect(text).toContain('refused 12 events');
		expect(text).toContain('nothing else reported this');
	});

	it('separates having nowhere to send from being refused', () => {
		const { container } = render(BrokerPage, {
			props: props({ status: status({ published: 0, dropped: 8, connected: false }) }),
		});
		const text = said(container);
		expect(text).toContain('had nowhere to go');
		expect(text).toContain('not at the broker');
	});

	it('names a disabled plugin as the cause rather than the broker', () => {
		const { container } = render(BrokerPage, {
			props: props({ status: status({ degraded: true, dropped: 40, published: 0 }) }),
		});
		const text = said(container);
		expect(text).toContain('Nothing is wrong with the broker');
	});

	// A counter reset by a restart is not a quiet week, and a reader comparing
	// today's number to yesterday's needs to know which it is.
	it('says the counters are per process', () => {
		const { container } = render(BrokerPage, { props: props() });
		expect(said(container)).toContain('since this process started');
	});
});

describe('the connection', () => {
	it('shows the target the engine already redacted', () => {
		const { container } = render(BrokerPage, {
			props: props({ status: status({ target: 'nats://%28redacted%29@broker:4222' }) }),
		});
		expect(said(container)).toContain('redacted');
	});

	it('marks a plaintext connection', () => {
		const { container } = render(BrokerPage, { props: props({ status: status({ tls: false }) }) });
		expect(said(container)).toContain('Off');
	});

	it('says nothing has been published rather than printing an empty date', () => {
		const { container } = render(BrokerPage, {
			props: props({ status: status({ published: 0, last_publish_at: null }) }),
		});
		expect(said(container)).toContain('Nothing has been published');
	});
});
