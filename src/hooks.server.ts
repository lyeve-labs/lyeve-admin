import { hostname } from 'node:os';
import { building, dev } from '$app/environment';
import { redirect, type Handle, type HandleFetch, type ServerInit } from '@sveltejs/kit';
import { cleanupRateLimitStore, WINDOW_MS } from '$lib/server/rate-limit';
import { setupGateRedirect } from '$lib/server/setup-gate';
import {
	callerOf,
	contentApiAddressProblem,
	signEngineRequest
} from '$lib/server/engine';
import { relayEngineCookies } from '$lib/server/engine-cookies';

const ENGINE_URL = process.env.CORE_INTERNAL_URL;

// A production server that cannot reach the Content API refuses to start.
// The fallback address is this console's own port in the official image, so
// running on it would answer every /api/v1 call from this application and
// report the result as the engine's. A failed start names the variable.
export const init: ServerInit = () => {
	if (dev || building) return;
	const problem = contentApiAddressProblem(process.env, hostname());
	if (problem) throw new Error(problem);
};

// Periodically prune expired rate-limit buckets so the in-memory Map
// does not grow without bound under diverse/spoofed client IPs.
// .unref() prevents the timer from keeping the Node.js process alive.
setInterval(cleanupRateLimitStore, WINDOW_MS).unref();

// Static security headers applied to every response. The Content-Security-Policy
// is configured in svelte.config.js (kit.csp) so SvelteKit can attach nonces to
// its own inline hydration scripts. Setting script-src here would break it.
export const handle: Handle = async ({ event, resolve }) => {
	// Every page goes to the setup screen until the engine has an account:
	// while it is unreachable, in setup mode, or waiting for its first admin.
	// This is the only setup check. A data request carries the page's own
	// path here, so client-side navigation is gated the same way.
	const target = await setupGateRedirect(event.url, event.fetch);
	if (target) {
		redirect(303, target);
	}

	const response = withMutableHeaders(await resolve(event));
	response.headers.set('X-Frame-Options', 'DENY');
	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
	response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
	response.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
	// Nothing here is for an index: every screen is behind a session and the
	// login is not a page worth finding. robots.txt says the same to the
	// crawlers that ask first.
	response.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
	// HSTS: force HTTPS in production. Gated. $app/environment dev is
	// true during local dev (http://localhost) where the header is harmful.
	if (!dev) {
		response.headers.set(
			'Strict-Transport-Security',
			'max-age=63072000; includeSubDomains; preload'
		);
	}
	return response;
};

/**
 * The response itself, or a copy whose headers can be set. A response passed
 * through from fetch, or built by Response.redirect, has immutable headers,
 * and setting one throws.
 */
function withMutableHeaders(response: Response): Response {
	try {
		response.headers.set('X-Content-Type-Options', 'nosniff');
		return response;
	} catch {
		return new Response(response.body, response);
	}
}

// Rewrite server-side relative /api/* requests to the engine when
// CORE_INTERNAL_URL is set (prod / adapter-node).  In dev the Vite proxy
// handles routing. This hook is a no-op when the var is unset.
//
// Without this hook, SvelteKit's event.fetch resolves relative URLS inside
// its own router.  There are no matching routes for /api/*, so every
// server-load fetch returns 404 on adapter-node.
//
// Every call bound for the engine is signed for the browser behind event, so
// the engine counts that browser rather than this server. Only a relative call,
// which resolves against this app's own origin, is the engine's: an absolute
// URL elsewhere that happens to start with /api/ gets neither the rewrite nor
// the browser's address.
export const handleFetch: HandleFetch = async ({ request, fetch, event }) => {
	const parsed = new URL(request.url);
	if (parsed.origin !== event.url.origin || !parsed.pathname.startsWith('/api/')) {
		return fetch(request);
	}
	const target = ENGINE_URL ? new URL(parsed.pathname + parsed.search, ENGINE_URL) : parsed;
	const outbound = new Request(target, request);
	signEngineRequest(outbound.headers, outbound.method, target, callerOf(event));
	const response = await fetch(outbound);
	// A rewritten call leaves this app, so SvelteKit does not pass the
	// engine's cookies on to the browser. The CSRF pair has to arrive anyway.
	if (ENGINE_URL) relayEngineCookies(response.headers, event.cookies);
	return response;
};
