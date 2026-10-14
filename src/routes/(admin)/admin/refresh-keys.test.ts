import { describe, expect, it, vi } from 'vitest';

/**
 * A page whose Refresh calls `invalidate` with a key reruns only the loads
 * that registered that key. Each of these loads registers its own, so its
 * Refresh rereads the page and leaves the shell's data where it is.
 */
const loads = import.meta.glob<{ load: (event: never) => unknown }>('./**/+page.server.ts');

const KEYS: [string, string][] = [
	['events', 'app:events'],
	['observability', 'app:observability'],
	['observability/profiler', 'app:profiler'],
	['observability/queries', 'app:observability-queries'],
	['observability/telemetry', 'app:telemetry'],
	['realtime', 'app:realtime'],
	['settings/grpc', 'app:grpc'],
	['settings/message-broker', 'app:message-broker'],
	['settings/pii', 'app:pii'],
];

describe('page loads a Refresh reruns', () => {
	it.each(KEYS)('%s registers %s', async (page, key) => {
		const { load } = await loads[`./${page}/+page.server.ts`]();
		const depends = vi.fn();
		const stop = new Error('stop before any read');
		await Promise.resolve()
			.then(() =>
				load({
					depends,
					url: new URL(`http://localhost/admin/${page}`),
					parent: async () => {
						throw stop;
					},
				} as never),
			)
			.catch((err: unknown) => {
				if (err !== stop) throw err;
			});
		expect(depends).toHaveBeenCalledWith(key);
	});
});
