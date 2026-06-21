import { ApiError } from '@lyeve-labs/client';

/**
 * The schema engine's answer while another instance holds the DDL lock: 503
 * with `Retry-After: 1`. It is the one refusal the engine means to be repeated,
 * so it is repeated once here rather than shown to the operator as "retry in
 * 1s" for them to repeat by hand.
 */
const BUSY_WAIT_MS = 1000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function retryBusy<T>(call: () => Promise<T>, wait: (ms: number) => Promise<void> = sleep): Promise<T> {
	try {
		return await call();
	} catch (err) {
		if (!(err instanceof ApiError) || err.status !== 503) throw err;
		await wait(BUSY_WAIT_MS);
		return call();
	}
}
