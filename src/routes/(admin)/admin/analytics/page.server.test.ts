import { describe, it, expect, vi } from 'vitest';
import type { Cookies } from '@sveltejs/kit';

import { load } from './+page.server';

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' },
	});
}

function mockCookies(): Cookies {
	return {
		get: vi.fn(() => 'tok'),
		set: vi.fn(),
		delete: vi.fn(),
		getAll: vi.fn(() => []),
		serialize: vi.fn(() => ''),
	} as unknown as Cookies;
}

function loadEvent(roles: string[]) {
	const queries: Record<string, URLSearchParams> = {};
	const fetch = vi.fn(async (url: string) => {
		const u = new URL(String(url), 'http://x');
		queries[u.pathname] = u.searchParams;
		return json({ items: [], total: 0, anomalies: [] });
	}) as unknown as typeof globalThis.fetch;
	return {
		queries,
		event: {
			fetch,
			cookies: mockCookies(),
			parent: async () => ({ user: { roles } }),
		} as never,
	};
}

/*
 * Left open, the metrics routes read every retained hour while the page
 * implies a day. The page states the range itself, so its numbers are the
 * dashboard's numbers whatever engine version answers.
 */
describe('admin/analytics/+page.server.ts load', () => {
	it('bounds every rolled-up read to the last day', async () => {
		const before = Date.now();
		const { queries, event } = loadEvent(['admin']);

		await load(event);

		const base = '/api/admin/apianalytics/metrics';
		const from = queries[`${base}/summary`].get('from') ?? '';
		const age = before - Date.parse(from);
		expect(age).toBeGreaterThanOrEqual(24 * 3_600_000 - 1000);
		expect(age).toBeLessThan(24 * 3_600_000 + 60_000);
		for (const route of ['endpoints', 'methods', 'agents']) {
			expect(queries[`${base}/${route}`].get('from')).toBe(from);
		}
		expect(queries[`${base}/anomalies`].get('from')).toBeNull();
	});

	it('refuses a reader without an admin role', async () => {
		const { event } = loadEvent(['editor']);

		await expect(load(event)).rejects.toMatchObject({ status: 403 });
	});
});
