// @vitest-environment jsdom
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/navigation', () => ({ invalidate: vi.fn(async () => {}), invalidateAll: vi.fn(async () => {}) }));

import BrokerPage from './+page.svelte';
import type { BrokerStatus } from '$lib/api/messagebroker';
import { invalidate, invalidateAll } from '$app/navigation';

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

/*
 * With EVENT_BUS unset or noop, the plugin hands each event to a publisher
 * that discards it, counts it as published and reports itself connected.
 * None of that reached a broker, so the page must not say it did.
 */
describe('an instance with no broker', () => {
	const none = (backend: string) =>
		props({ status: status({ backend, target: '', stream: '', tls: false, published: 25 }) });

	it.each(['', 'noop'])('claims no delivery with backend "%s"', (backend) => {
		const { container } = render(BrokerPage, none(backend));
		const text = said(container);
		expect(text).not.toContain('reached the broker');
		expect(text).not.toContain('Publishing');
		expect(text).toContain('No broker, events are discarded');
		expect(text).toContain('Published counts events that were discarded');
	});

	it('states no connection, TLS setting or publish time', () => {
		const { container } = render(BrokerPage, none(''));
		const row = (name: string) =>
			[...container.querySelectorAll('th')].find((th) => th.textContent?.trim() === name)?.nextElementSibling?.textContent?.trim();
		expect(row('Connected')).toBe('-');
		expect(row('TLS')).toBe('-');
		expect(row('Last publish')).toBe('Nothing has been published');
	});

	it('still states the delivery rate with a broker', () => {
		const { container } = render(BrokerPage, props({ status: status({ published: 9, failed: 1 }) }));
		expect(said(container)).toContain('90% of attempts reached the broker.');
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

describe('where the broker is set', () => {
	it('names EVENT_BUS alone in one sentence when no broker is set', () => {
		const { container } = render(BrokerPage, props({ status: status({ backend: '' }) }));
		const text = said(container);
		expect(text).toContain('through EVENT_BUS. Set it as an environment variable');
		expect(text).not.toContain('EVENT_BUS .');
	});

	it('names every setting the backend reads', () => {
		const { container } = render(BrokerPage, props({ status: status({ backend: 'rabbitmq' }) }));
		expect(said(container)).toContain(
			'through EVENT_BUS and RABBITMQ_URL, RABBITMQ_TLS, RABBITMQ_TLS_CA_FILE. Set them as environment variables'
		);
	});
});

describe('Refresh', () => {
	it("rereads the page's own load and leaves the shell's data alone", async () => {
		vi.mocked(invalidate).mockClear();
		vi.mocked(invalidateAll).mockClear();
		const { getByRole } = render(BrokerPage, { props: props() });
		await fireEvent.click(getByRole('button', { name: 'Refresh' }));
		expect(invalidate).toHaveBeenCalledWith('app:message-broker');
		expect(invalidateAll).not.toHaveBeenCalled();
	});
});
