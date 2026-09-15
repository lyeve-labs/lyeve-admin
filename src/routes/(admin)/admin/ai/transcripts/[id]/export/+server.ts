import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { flowAuthHeaders } from '$lib/server/flow-import';
import { transcriptExportPath } from '$lib/api/ai';
import { sessionToken } from '$lib/server/session-cookie';

/**
 * The transcript download, as a plain link.
 *
 * The browser cannot send the session to the engine itself: the cookie is
 * httpOnly and the engine wants a bearer. This route reads the cookie and
 * forwards the file with the engine's own content type and filename, so an
 * anchor with `download` is all the page needs.
 */
export const GET: RequestHandler = async ({ cookies, params, url, fetch }) => {
	const token = sessionToken({ cookies, url });
	if (!token) error(401, 'Not authenticated');
	const format = url.searchParams.get('format') === 'markdown' ? 'markdown' : 'json';

	let res: Response;
	try {
		res = await fetch(transcriptExportPath(params.id, format), { headers: flowAuthHeaders({ cookies, url }) });
	} catch {
		error(502, 'Engine unreachable');
	}
	if (!res.ok) {
		if (res.status === 404) error(404, 'Transcript not found');
		if (res.status === 402) error(402, 'AI is not enabled on this instance');
		if (res.status === 403) error(403, 'Your role cannot export transcripts');
		error(502, 'The transcript could not be exported');
	}
	const headers = new Headers();
	headers.set('Content-Type', res.headers.get('content-type') ?? (format === 'markdown' ? 'text/markdown; charset=utf-8' : 'application/json; charset=utf-8'));
	headers.set(
		'Content-Disposition',
		res.headers.get('content-disposition') ?? `attachment; filename="transcript-${params.id}.${format === 'markdown' ? 'md' : 'json'}"`
	);
	headers.set('Cache-Control', 'no-store');
	return new Response(res.body, { status: 200, headers });
};
