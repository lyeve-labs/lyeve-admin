import { describe, it, expect, vi } from 'vitest';
import type { Cookies } from '@sveltejs/kit';

import { actions, load } from './+page.server';

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' },
	});
}

const OPENAPI = {
	paths: {
		'/api/v1/content/{schema}': {
			post: { summary: 'Create a record', tags: ['Content API / Content'] },
		},
	},
};

/** A session and a csrf cookie, the way a signed-in browser presents them. */
function mockCookies(csrf: string | null): Cookies {
	return {
		get: vi.fn((name: string) => {
			if (name === '__Host-csrf') return csrf ?? undefined;
			if (name === 'csrf') return undefined;
			return 'session-token';
		}),
		set: vi.fn(),
		delete: vi.fn(),
		getAll: vi.fn(() => []),
		serialize: vi.fn(() => ''),
	} as unknown as Cookies;
}

function sendEvent(form: Record<string, string>, csrf: string | null = 'csrf-value') {
	const sent: { url: string; init: RequestInit }[] = [];
	const fetch = vi.fn(async (url: string, init?: RequestInit) => {
		sent.push({ url: String(url), init: init ?? {} });
		if (String(url).includes('openapi.json')) return json(OPENAPI);
		if (String(url).includes('grpc/status')) {
			return json({ listening: true, transcoded_routes: ['GET /api/content/{schema}'] });
		}
		return json({ ok: true }, 201);
	}) as unknown as typeof globalThis.fetch;

	const body = new URLSearchParams(form);
	return {
		sent,
		event: {
			fetch,
			cookies: mockCookies(csrf),
			request: new Request('http://x/admin/api-labs', {
				method: 'POST',
				body,
				headers: { 'content-type': 'application/x-www-form-urlencoded' },
			}),
		} as never,
	};
}

function headerOf(init: RequestInit, name: string): string | undefined {
	return (init.headers as Record<string, string> | undefined)?.[name];
}

/*
 * The engine enforces double-submit CSRF on a cookie-authenticated write.
 * event.fetch forwards the browser's cookies on a same-origin subrequest, so
 * the engine sees its own session cookie and applies that check. A lab that
 * does not echo the token has every write refused with 403 "csrf token
 * required", which reads as the route rejecting the request rather than the
 * lab never having been allowed to make it.
 *
 * A mocked fetch answers whatever it is told to, so only the real CSRF check
 * shows a missing token. These cases pin the header itself.
 */
describe('a lab write echoes the CSRF token', () => {
	it('sends X-CSRF-Token on a REST write', async () => {
		const { sent, event } = sendEvent({
			endpoint: 'POST /api/v1/content/{schema}',
			p_schema: 'post',
			body: '{"title":"x"}',
		});

		await actions.rest(event);

		const write = sent.find((s) => s.init.method === 'POST' && s.url.includes('/content/'));
		expect(write, 'the write never went out').toBeDefined();
		expect(headerOf(write!.init, 'X-CSRF-Token')).toBe('csrf-value');
	});

	it('sends X-CSRF-Token on a GraphQL call', async () => {
		const { sent, event } = sendEvent({ document: '{ ping }' });

		await actions.graphql(event);

		const call = sent.find((s) => s.url.includes('/graphql'));
		expect(call, 'the call never went out').toBeDefined();
		expect(headerOf(call!.init, 'X-CSRF-Token')).toBe('csrf-value');
	});

	it('sends X-CSRF-Token on a transcoded gRPC call', async () => {
		const { sent, event } = sendEvent({
			route: 'GET /api/content/{schema}',
			g_schema: 'post',
		});

		await actions.grpc(event);

		const call = sent.find((s) => s.url.includes('grpc/invoke'));
		expect(call, 'the call never went out').toBeDefined();
		expect(headerOf(call!.init, 'X-CSRF-Token')).toBe('csrf-value');
	});

	it('omits the header when there is no token rather than sending an empty one', async () => {
		// The engine is a separate origin here, so no cookie was forwarded and
		// no check applies. An empty header would fail the check it is meant
		// to pass.
		const { sent, event } = sendEvent({ document: '{ ping }' }, null);

		await actions.graphql(event);

		const call = sent.find((s) => s.url.includes('/graphql'));
		expect(call).toBeDefined();
		expect(headerOf(call!.init, 'X-CSRF-Token')).toBeUndefined();
	});
});

describe('the gRPC action takes its allowlist from the engine', () => {
	it('refuses a route the listener does not report, whatever the form says', async () => {
		const { sent, event } = sendEvent({ route: 'GET http://example.invalid/steal' });

		const result = (await actions.grpc(event)) as { status: number; data: { error: string } };

		expect(result.status).toBe(400);
		expect(result.data.error).toContain('not a route this listener transcodes');
		expect(sent.some((s) => s.url.includes('grpc/invoke'))).toBe(false);
	});

	it('refuses a route whose parameter was left empty', async () => {
		const { sent, event } = sendEvent({ route: 'GET /api/content/{schema}', g_schema: '  ' });

		const result = (await actions.grpc(event)) as { status: number; data: { error: string } };

		expect(result.status).toBe(400);
		expect(result.data.error).toContain('schema');
		expect(sent.some((s) => s.url.includes('grpc/invoke'))).toBe(false);
	});
});

/*
 * The gRPC tab's status read. The route is a super admin's, so the read is
 * made for one alone, and only a 404 says the plugin is not here.
 */
describe('admin/api-labs gRPC status', () => {
	function loadEvent(roles: string[], status: () => Response) {
		const asked: string[] = [];
		const fetch = vi.fn(async (url: string) => {
			asked.push(String(url));
			if (String(url).includes('grpc/status')) return status();
			return json(OPENAPI);
		}) as unknown as typeof globalThis.fetch;
		return {
			asked,
			event: { fetch, cookies: mockCookies(null), url: new URL('http://x/admin/api-labs'), parent: async () => ({ user: { roles } }) } as never,
		};
	}
	type Loaded = { grpc: { gate: { state: string }; routes: string[] } };

	it('does not ask for the status below super admin, and says the role is why', async () => {
		const { asked, event } = loadEvent(['admin'], () => json({ listening: true }));
		const d = (await load(event)) as unknown as Loaded;
		expect(asked.some((u) => u.includes('grpc/status'))).toBe(false);
		expect(d.grpc.gate).toEqual({ state: 'forbidden' });
	});

	it('reads the routes for a super admin', async () => {
		const { event } = loadEvent(['super_admin'], () => json({ listening: true, transcoded_routes: ['GET /api/schemas'] }));
		const d = (await load(event)) as unknown as Loaded;
		expect(d.grpc.gate).toEqual({ state: 'ok' });
		expect(d.grpc.routes).toEqual(['GET /api/schemas']);
	});

	it('says absent only for a 404', async () => {
		const { event } = loadEvent(['super_admin'], () => json({ error: 'not found' }, 404));
		expect(((await load(event)) as unknown as Loaded).grpc.gate).toEqual({ state: 'absent' });
	});

	it('reads an outage as one, with a retry', async () => {
		const { event } = loadEvent(['super_admin'], () => json({ error: 'down' }, 503));
		expect(((await load(event)) as unknown as Loaded).grpc.gate).toEqual({ state: 'unavailable' });
	});

	it('reads a refusal as the role it is', async () => {
		const { event } = loadEvent(['super_admin'], () => json({ error: 'forbidden' }, 403));
		expect(((await load(event)) as unknown as Loaded).grpc.gate).toEqual({ state: 'forbidden' });
	});
});

describe('a lab request that never reached the engine', () => {
	// The runtime's words for a failed connection can name an internal address.
	it('says it could not be sent, in the console\'s words only', async () => {
		const { event } = sendEvent({ document: '{ ping }' });
		(event as { fetch: unknown }).fetch = vi.fn(async () => {
			throw new TypeError('fetch failed: connect ECONNREFUSED 10.0.0.5:8080');
		});
		const out = (await actions.graphql(event)) as { status: number; data: { error: string } };
		expect(out.data.error).toBe('The request could not be sent to the engine. Try again in a moment.');
	});
});
