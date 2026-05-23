// @vitest-environment jsdom
import { render, cleanup, fireEvent, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import StreamLab from './StreamLab.svelte';

/** Records what the component opened and lets a test deliver events. */
class FakeEventSource {
	static CLOSED = 2;
	static last: FakeEventSource | null = null;
	readyState = 0;
	onopen: (() => void) | null = null;
	onerror: (() => void) | null = null;
	onmessage: ((e: MessageEvent) => void) | null = null;
	listeners = new Map<string, (e: MessageEvent) => void>();
	closed = false;
	constructor(public url: string) {
		FakeEventSource.last = this;
	}
	addEventListener(name: string, fn: (e: MessageEvent) => void) {
		this.listeners.set(name, fn);
	}
	close() {
		this.closed = true;
	}
	emit(name: string, data: string, id: string) {
		this.listeners.get(name)?.(new MessageEvent(name, { data, lastEventId: id }));
	}
}

beforeEach(() => {
	FakeEventSource.last = null;
	vi.stubGlobal('EventSource', FakeEventSource);
});
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

describe('StreamLab', () => {
	it('subscribes to the topics given and shows each event under its topic', async () => {
		render(StreamLab);
		const topics = screen.getByLabelText('Topics') as HTMLInputElement;
		await fireEvent.input(topics, { target: { value: 'content:posts, schema:changed' } });
		await fireEvent.click(screen.getByRole('button', { name: /Connect/ }));

		const es = FakeEventSource.last!;
		expect(es.url).toBe('/api/v1/realtime/events?topic=content%3Aposts&topic=schema%3Achanged');
		expect([...es.listeners.keys()]).toEqual(['content:posts', 'schema:changed']);
		es.onopen?.();
		es.emit('content:posts', '{"action":"create","id":"7"}', '41');
		await tick();

		expect(screen.getByText('open')).toBeTruthy();
		expect(screen.getByText('{"action":"create","id":"7"}')).toBeTruthy();
		expect(screen.getByText('41')).toBeTruthy();

		await fireEvent.click(screen.getByRole('button', { name: /Disconnect/ }));
		expect(es.closed).toBe(true);
	});

	it('listens on the catch-all when no topic is given', async () => {
		render(StreamLab);
		await fireEvent.input(screen.getByLabelText('Topics'), { target: { value: '' } });
		await fireEvent.click(screen.getByRole('button', { name: /Connect/ }));
		expect(FakeEventSource.last!.url).toBe('/api/v1/realtime/events');
		expect([...FakeEventSource.last!.listeners.keys()]).toEqual(['*']);
	});

	it('says so when the stream is refused', async () => {
		render(StreamLab);
		await fireEvent.click(screen.getByRole('button', { name: /Connect/ }));
		const es = FakeEventSource.last!;
		es.readyState = FakeEventSource.CLOSED;
		es.onerror?.();
		await tick();
		expect(screen.getByText(/The stream was refused/)).toBeTruthy();
	});
});
