import { describe, it, expect, vi } from 'vitest';
import type { Cookies } from '@sveltejs/kit';

import { actions } from './+page.server';

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
