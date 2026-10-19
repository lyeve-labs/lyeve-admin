import { afterEach, describe, expect, it, vi } from 'vitest';

const engineFetch = vi.fn();
vi.mock('$lib/server/engine', () => ({ engineFetch: (...args: unknown[]) => engineFetch(...args), POOL_HEALTH_TIMEOUT_MS: 5000 }));

const { GET } = await import('./+server');
const { POOL_HEALTH_TIMEOUT_MS } = await import('$lib/server/engine');

afterEach(() => {
	engineFetch.mockReset();
	vi.restoreAllMocks();
});

function event(token?: string) {
	return {
		url: new URL('http://localhost/api/admin/pool/health'),
		cookies: { get: (name: string) => (token && name.includes('session') ? token : undefined) },
		getClientAddress: () => '127.0.0.1',
	} as never;
}

async function status(run: () => unknown): Promise<number> {
	try {
		const res = (await run()) as Response;
		return res.status;
	} catch (e) {
		return (e as { status: number }).status;
	}
}

describe('pool health proxy', () => {
	it('refuses a request without a session before calling the engine', async () => {
		expect(await status(() => GET(event()))).toBe(401);
		expect(engineFetch).not.toHaveBeenCalled();
	});

	it('relays the engine answer', async () => {
		engineFetch.mockResolvedValue(new Response('{"healthy":true}', { status: 200 }));
		const res = (await GET(event('tok'))) as Response;
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ healthy: true });
	});

	it('gives a stalled engine a deadline and answers 502 when it passes', async () => {
		const timeout = vi
			.spyOn(AbortSignal, 'timeout')
			.mockImplementation(() => AbortSignal.abort(new DOMException('timed out', 'TimeoutError')));
		engineFetch.mockImplementation(
			(_event: unknown, _path: string, init: RequestInit) =>
				new Promise((_resolve, reject) => {
					const signal = init.signal;
					// No signal is a request that waits on the engine for as long as it stalls.
					if (!signal) return;
					if (signal.aborted) reject(signal.reason);
					signal.addEventListener('abort', () => reject(signal.reason));
				}),
		);
		const outcome = await Promise.race([
			status(() => GET(event('tok'))),
			new Promise<string>((resolve) => setTimeout(() => resolve('still waiting'), 500)),
		]);
		expect(outcome).toBe(502);
		expect(timeout).toHaveBeenCalledWith(POOL_HEALTH_TIMEOUT_MS);
	});
});
