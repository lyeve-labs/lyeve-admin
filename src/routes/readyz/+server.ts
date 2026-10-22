import type { RequestHandler } from './$types';
import { ENGINE_READY_TIMEOUT_MS, engineBaseFor } from '$lib/server/engine';

/**
 * What the probe asks. It is the read the setup gate makes before every page,
 * under the path the console's own engine calls take, so it fails wherever
 * those calls would: the engine down, still starting, without its database,
 * or unreachable through the proxy CORE_INTERNAL_URL names. The engine's
 * /readyz is no use here, because a proxy that routes only /api to the engine
 * sends it back to this console.
 */
const ENGINE_PROBE_PATH = '/api/admin/setup/status';

/**
 * The console's readiness probe: 200 while the engine answers, 503 otherwise.
 * Every screen needs the engine, so a console that cannot reach it has
 * nothing to serve, and the root page answers 200 either way. A 429 is an
 * engine that is up, as the setup gate reads it. The probe needs no session
 * and says nothing beyond up or down, because whoever can reach the port can
 * reach it.
 */
export const GET: RequestHandler = async () => {
	let ready = false;
	try {
		const res = await fetch(new URL(ENGINE_PROBE_PATH, engineBaseFor(ENGINE_PROBE_PATH)).href, {
			signal: AbortSignal.timeout(ENGINE_READY_TIMEOUT_MS),
		});
		ready = res.ok || res.status === 429;
		await res.body?.cancel();
	} catch {
		ready = false;
	}
	return new Response(ready ? 'ready\n' : 'unavailable\n', {
		status: ready ? 200 : 503,
		headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
	});
};
