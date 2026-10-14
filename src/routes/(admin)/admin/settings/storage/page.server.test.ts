import { describe, expect, it, vi } from 'vitest';
import type { Cookies } from '@sveltejs/kit';

import { actions } from './+page.server';

type Call = { method: string; path: string; body: unknown };
type Failure = { status: number; data: { error?: string; providerError?: string } };

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
	const url = new URL('http://localhost/admin/settings/storage');
	return {
		calls,
		event: { fetch, cookies: cookies(), url, request: new Request(url, { method: 'POST', body: form }) } as never,
	};
}


const OUTAGE = json({ error: 'dial tcp 10.0.0.4:5432: connection refused' }, 503);
const S3 = { provider_type: 's3', name: ' Uploads ', bucket: 'uploads', region: 'us-east-1', access_key: 'AK', secret_key: 'SK', priority: '5', enabled: 'on' };

describe('storage writes by role', () => {
	it.each([
		['create', S3],
		['update', { id: 'p1', ...S3 }],
		['delete', { id: 'p1' }],
	] as const)('refuses %s to an admin before it reaches the engine', async (name, fields) => {
		const { event, calls } = engine(fields, { roles: ['admin'] });
		await expect(actions[name](event)).rejects.toMatchObject({ status: 403 });
		expect(calls).toEqual([]);
	});

	it('lets an admin test a provider', async () => {
		const { event, calls } = engine({ id: 'p1' }, { roles: ['admin'], reply: json({ success: true }) });
		expect(await actions.test(event)).toEqual({ tested: 'p1' });
		expect(calls).toEqual([{ method: 'POST', path: '/api/admin/storage/providers/p1/test', body: {} }]);
	});

	it('refuses a test to an editor', async () => {
		const { event, calls } = engine({ id: 'p1' }, { roles: ['editor'] });
		await expect(actions.test(event)).rejects.toMatchObject({ status: 403 });
		expect(calls).toEqual([]);
	});
});

describe('testing a provider', () => {
	it('reads an answer without an explicit success as a refusal', async () => {
		const { event } = engine({ id: 'p1' }, { reply: json({ message: 'access denied by bucket policy' }) });
		const out = (await actions.test(event)) as Failure;
		expect(out.status).toBe(400);
		expect(out.data.error).toBe('The provider refused: access denied by bucket policy');
	});

	it('accepts success under its second field name', async () => {
		const { event } = engine({ id: 'p1' }, { reply: json({ ok: true }) });
		expect(await actions.test(event)).toEqual({ tested: 'p1' });
	});

	it('relays a refusal and hides an outage', async () => {
		const refused = engine({ id: 'p1' }, { reply: json({ error: 'provider not found' }, 404) });
		expect(((await actions.test(refused.event)) as Failure).data.error).toBe('provider not found');
		const down = engine({ id: 'p1' }, { reply: OUTAGE });
		expect(((await actions.test(down.event)) as Failure).data.error).toBe('The provider could not be tested.');
	});
});

describe('creating a provider', () => {
	it('posts the provider with its credentials', async () => {
		const { event, calls } = engine(S3, { reply: json({ id: 'p2', name: 'Uploads' }) });
		expect(await actions.create(event)).toEqual({ saved: 'Uploads' });
		expect(calls).toEqual([
			{
				method: 'POST',
				path: '/api/admin/storage/providers',
				body: {
					provider_type: 's3',
					name: 'Uploads',
					use_ssl: false,
					path_style: false,
					enabled: true,
					local_public_unsigned: false,
					priority: 5,
					bucket: 'uploads',
					region: 'us-east-1',
					access_key: 'AK',
					secret_key: 'SK',
				},
			},
		]);
	});

	it('asks for a missing credential before it sends anything', async () => {
		const { event, calls } = engine({ ...S3, secret_key: '' });
		const out = (await actions.create(event)) as Failure;
		expect(out.data.providerError).toBe('Secret access key is required.');
		expect(calls).toEqual([]);
	});

	it('relays a refusal in the drawer and hides an outage', async () => {
		const refused = engine(S3, { reply: json({ error: 'a provider with this name exists' }, 409) });
		expect(((await actions.create(refused.event)) as Failure).data).toEqual({ providerError: 'a provider with this name exists' });
		const down = engine(S3, { reply: OUTAGE });
		expect(((await actions.create(down.event)) as Failure).data).toEqual({ providerError: 'The provider could not be created.' });
	});
});

describe('saving a provider', () => {
	it('keeps the stored credentials when the edit leaves them empty', async () => {
		const { event, calls } = engine({ id: 'p1', ...S3, access_key: '', secret_key: '' });
		expect(await actions.update(event)).toEqual({ saved: 'Uploads' });
		expect(calls).toHaveLength(1);
		expect(calls[0].method).toBe('PUT');
		expect(calls[0].path).toBe('/api/admin/storage/providers/p1');
		expect(calls[0].body).not.toHaveProperty('access_key');
		expect(calls[0].body).not.toHaveProperty('secret_key');
	});

	it('names nothing to save without a request', async () => {
		const { event, calls } = engine(S3);
		expect(((await actions.update(event)) as Failure).data).toEqual({ providerError: 'No provider was named.' });
		expect(calls).toEqual([]);
	});

	it('relays a refusal in the drawer and hides an outage', async () => {
		const refused = engine({ id: 'p1', ...S3 }, { reply: json({ error: 'region is not valid for this endpoint' }, 422) });
		expect(((await actions.update(refused.event)) as Failure).data).toEqual({ providerError: 'region is not valid for this endpoint' });
		const down = engine({ id: 'p1', ...S3 }, { reply: OUTAGE });
		expect(((await actions.update(down.event)) as Failure).data).toEqual({ providerError: 'The provider could not be saved.' });
	});
});

describe('removing a provider', () => {
	it('deletes the named provider', async () => {
		const { event, calls } = engine({ id: 'p1' });
		expect(await actions.delete(event)).toEqual({ removed: 'p1' });
		expect(calls).toEqual([{ method: 'DELETE', path: '/api/admin/storage/providers/p1', body: undefined }]);
	});

	it('relays a refusal and hides an outage', async () => {
		const refused = engine({ id: 'p1' }, { reply: json({ error: 'provider holds files' }, 409) });
		expect(((await actions.delete(refused.event)) as Failure).data).toEqual({ error: 'provider holds files' });
		const down = engine({ id: 'p1' }, { reply: OUTAGE });
		expect(((await actions.delete(down.event)) as Failure).data).toEqual({ error: 'The provider could not be removed.' });
	});
});
