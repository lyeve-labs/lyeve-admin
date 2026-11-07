import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authedHeaders } from '$lib/server/authz';
import { exportPath } from '$lib/api/builder-forms';

/**
 * One form's submissions as a CSV file, as a plain link.
 *
 * The session cookie is httpOnly and the engine wants a bearer, so this
 * route reads the cookie and streams the engine's file back with its own
 * type and filename.
 */
export const GET: RequestHandler = async ({ cookies, url, fetch }) => {
	const auth = authedHeaders({ cookies, url });
	const site = url.searchParams.get('site') ?? '';
	const path = url.searchParams.get('path') ?? '';
	const block = url.searchParams.get('block') ?? '';
	if (!site || !path || !block) error(400, 'Choose a form first.');

	let res: Response;
	try {
		res = await fetch(exportPath({ site, path, block }), { headers: auth });
	} catch {
		error(502, 'Could not reach the engine. Try again in a moment.');
	}
	if (!res.ok) {
		if (res.status === 403) error(403, 'Only an admin or a super admin can export form submissions.');
		if (res.status === 404) error(404, 'Exporting form submissions needs a newer version of the builder plugin.');
		error(502, 'Could not export the submissions. Try again.');
	}
	const headers = new Headers();
	headers.set('Content-Type', res.headers.get('content-type') ?? 'text/csv; charset=utf-8');
	headers.set('Content-Disposition', res.headers.get('content-disposition') ?? 'attachment; filename="form-submissions.csv"');
	headers.set('Cache-Control', 'no-store');
	return new Response(res.body, { status: 200, headers });
};
