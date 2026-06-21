import { error, type RequestEvent } from '@sveltejs/kit';
import { createClient, type HttpClient } from '@lyeve-labs/client';
import { refusalAware } from '$lib/api/flows';
import { flowAuthHeaders } from './flow-import';
import { sessionToken } from '$lib/server/session-cookie';


/**
 * The authed client for a flow write. The same session and CSRF headers as
 * `authedClient`, over a fetch that keeps a 402 body: the flow plugin's
 * refusals name the node ids or the ceiling, and the page renders them.
 */
export function flowClient(event: RequestEvent): HttpClient {
	if (!sessionToken(event)) error(401, 'Not authenticated');
	const headers = flowAuthHeaders(event);
	return createClient(refusalAware(event.fetch), headers);
}
