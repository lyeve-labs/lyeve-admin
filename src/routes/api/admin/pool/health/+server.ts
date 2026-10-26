import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { engineFetch, POOL_HEALTH_TIMEOUT_MS } from '$lib/server/engine';
import { sessionToken } from '$lib/server/session-cookie';

/**
 * Proxies GET /api/admin/pool/health to the engine with auth.
 * Browser-side fetch can't read the httpOnly __Host-sys_session cookie,
 * so this server route reads it and forwards as an Authorization header.
 */
export const GET: RequestHandler = async (event) => {
	const token = sessionToken(event);
	if (!token) error(401, 'Not authenticated');

	try {
		const res = await engineFetch(event, '/api/admin/pool/health', {
			token,
			signal: AbortSignal.timeout(POOL_HEALTH_TIMEOUT_MS),
		});
		return json(await res.json(), { status: res.status });
	} catch {
		error(502, 'Engine unreachable');
	}
};
