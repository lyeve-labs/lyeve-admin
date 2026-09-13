import type { RequestHandler } from './$types';

/**
 * Every screen is behind a session, so there is nothing to index and the
 * login is the only thing a crawler would ever see. A crawler asks here
 * before anything else. The same refusal rides on every response as
 * X-Robots-Tag for the crawlers that never ask.
 */
export const GET: RequestHandler = () =>
	new Response('User-agent: *\nDisallow: /\n', {
		headers: {
			'Content-Type': 'text/plain; charset=utf-8',
			'Cache-Control': 'public, max-age=86400',
		},
	});
