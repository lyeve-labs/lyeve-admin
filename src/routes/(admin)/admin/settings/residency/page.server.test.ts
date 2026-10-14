import { describe, expect, it, vi } from 'vitest';
import type { Cookies } from '@sveltejs/kit';

import { actions } from './+page.server';

type Call = { method: string; path: string; body: unknown };
type Failure = { status: number; data: { action?: string; error: string } };

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function cookies(): Cookies {
	return { get: vi.fn(() => 'tok'), set: vi.fn(), delete: vi.fn(), getAll: vi.fn(() => []), serialize: vi.fn(() => '') } as unknown as Cookies;
}

/**
 * An action event against a fake engine. The session check answers with the
 * given roles, and every other request is recorded and answered with `reply`.
 */
function engine(fields: Record<string, string>, opts: { roles?: string[]; reply?: Response } = {}) {
	const calls: Call[] = [];
	const fetch = vi.fn(async (url: string, init?: RequestInit) => {
		const path = String(url);
		if (path.includes('/auth/me')) return json({ id: 'u1', roles: opts.roles ?? ['super_admin'], disabled: false });
		calls.push({ method: init?.method ?? 'GET', path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
		return opts.reply?.clone() ?? json({});
	});
	const form = new FormData();
	for (const [k, v] of Object.entries(fields)) form.set(k, v);
	const url = new URL('http://localhost/admin/settings/residency');
	return {
		calls,
		event: { fetch, cookies: cookies(), url, request: new Request(url, { method: 'POST', body: form }) } as never,
	};
}

const REGION = { slug: 'eu-west', display_name: ' EU West ', provider: 'aws', lat: '53.3', long: '-6.2', enabled: 'true' };
const OUTAGE = json({ error: 'dial tcp 10.0.0.4:5432: connection refused' }, 503);

describe('region writes', () => {
	it.each([
		['create', REGION],
		['update', { id: 'r1', ...REGION }],
		['delete', { id: 'r1' }],
	] as const)('refuses %s to an admin before it reaches the engine', async (name, fields) => {
		const { event, calls } = engine(fields, { roles: ['admin'] });
		await expect(actions[name](event)).rejects.toMatchObject({ status: 403 });
		expect(calls).toEqual([]);
	});

	it('creates a region with its coordinates', async () => {
		const { event, calls } = engine(REGION);
		expect(await actions.create(event)).toEqual({ saved: 'eu-west' });
		expect(calls).toEqual([
			{
				method: 'POST',
				path: '/api/admin/regions',
				body: {
					slug: 'eu-west',
					display_name: 'EU West',
					provider: 'aws',
					coordinates: { lat: 53.3, long: -6.2 },
					enabled: true,
					is_default: false,
				},
			},
		]);
	});

	it('leaves out coordinates that were never filled in', async () => {
		const { event, calls } = engine({ ...REGION, lat: '0', long: '0' });
		await actions.create(event);
		expect(calls[0].body).not.toHaveProperty('coordinates');
	});

	it.each([
		[{ slug: 'EU West' }, 'A region slug is lower case letters'],
		[{ display_name: ' ' }, 'Give the region a name a person can read.'],
		[{ provider: '' }, 'Name who runs it'],
	])('refuses %o before it creates anything', async (over, sentence) => {
		const { event, calls } = engine({ ...REGION, ...over });
		const out = (await actions.create(event)) as Failure;
		expect(out.data.action).toBe('create');
		expect(out.data.error).toContain(sentence);
		expect(calls).toEqual([]);
	});

	it('saves a region without sending its slug', async () => {
		const { event, calls } = engine({ id: 'r1', ...REGION, slug: 'renamed' });
		expect(await actions.update(event)).toEqual({ saved: 'EU West' });
		expect(calls).toHaveLength(1);
		expect(calls[0]).toMatchObject({ method: 'PUT', path: '/api/admin/regions/r1' });
		expect(calls[0].body).not.toHaveProperty('slug');
	});

	it('deletes the named region', async () => {
		const { event, calls } = engine({ id: 'r1' });
		expect(await actions.delete(event)).toEqual({ removed: 'r1' });
		expect(calls).toEqual([{ method: 'DELETE', path: '/api/admin/regions/r1', body: undefined }]);
	});

	it.each(['update', 'delete'] as const)('names nothing to %s without a request', async (name) => {
		const { event, calls } = engine({ display_name: 'EU West' });
		expect(((await actions[name](event)) as Failure).data).toEqual({ action: name, error: 'No region was named.' });
		expect(calls).toEqual([]);
	});

	it.each(['create', 'update', 'delete'] as const)('relays the engine refusal on %s under its action', async (name) => {
		const { event } = engine({ id: 'r1', ...REGION }, { reply: json({ error: 'region has tenants assigned' }, 409) });
		const out = (await actions[name](event)) as Failure;
		expect(out.data).toEqual({ action: name, error: 'region has tenants assigned' });
	});

	it.each([
		['create', 'The region could not be created.'],
		['update', 'The region could not be saved.'],
		['delete', 'The region could not be removed.'],
	] as const)('keeps outage detail off the page on %s', async (name, sentence) => {
		const { event } = engine({ id: 'r1', ...REGION }, { reply: OUTAGE });
		expect(((await actions[name](event)) as Failure).data).toEqual({ action: name, error: sentence });
	});
});
