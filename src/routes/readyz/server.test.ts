import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET } from './+server';
import { ENGINE_READY_TIMEOUT_MS } from '$lib/server/engine';

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

const probe = () => GET({} as never);

describe('readyz', () => {
	it('answers 200 while the engine answers the setup read', async () => {
		const fetchMock = vi.fn(async () => new Response('{"setup_required":false}', { status: 200 }));
		vi.stubGlobal('fetch', fetchMock);
		const res = await probe();
		expect(res.status).toBe(200);
		expect(await res.text()).toBe('ready\n');
		expect(res.headers.get('Cache-Control')).toBe('no-store');
		const [url] = fetchMock.mock.calls[0] as unknown as [string];
		expect(new URL(url).pathname).toBe('/api/admin/setup/status');
	});

	it('reads a rate-limited answer as an engine that is up', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"slow down"}', { status: 429 })));
		expect((await probe()).status).toBe(200);
	});

	it('answers 503 while the engine cannot serve, and repeats none of its answer', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => new Response('{"code":"database_error"}', { status: 503 })));
		const res = await probe();
		expect(res.status).toBe(503);
		expect(await res.text()).toBe('unavailable\n');
	});

	it('answers 503 when the engine cannot be reached', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => {
			throw new TypeError('fetch failed');
		}));
		expect((await probe()).status).toBe(503);
	});

	it('gives a stalled engine a deadline and answers 503 when it passes', async () => {
		const timeout = vi
			.spyOn(AbortSignal, 'timeout')
			.mockImplementation(() => AbortSignal.abort(new DOMException('timed out', 'TimeoutError')));
		vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) =>
			new Promise<Response>((_resolve, reject) => {
				const signal = init?.signal;
				if (!signal) return;
				if (signal.aborted) reject(signal.reason);
				signal.addEventListener('abort', () => reject(signal.reason));
			}),
		));
		expect((await probe()).status).toBe(503);
		expect(timeout).toHaveBeenCalledWith(ENGINE_READY_TIMEOUT_MS);
	});
});
