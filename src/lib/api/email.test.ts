import { describe, expect, it, vi } from 'vitest';
import type { HttpClient } from '@lyeve-labs/client';
import {
	createEmailProvider,
	deleteEmailProvider,
	listEmailProviders,
	toEmailProvider,
	updateEmailProvider,
	webhookPath,
} from './email';

function client(answer: unknown = {}) {
	const calls: { method: string; url: string; body?: unknown }[] = [];
	const c = {
		get: vi.fn(async (url: string) => (calls.push({ method: 'GET', url }), answer)),
		post: vi.fn(async (url: string, body: unknown) => (calls.push({ method: 'POST', url, body }), answer)),
		put: vi.fn(async (url: string, body: unknown) => (calls.push({ method: 'PUT', url, body }), answer)),
		delete: vi.fn(async (url: string) => (calls.push({ method: 'DELETE', url }), undefined)),
	} as unknown as HttpClient;
	return { c, calls };
}

describe('toEmailProvider', () => {
	it('defaults a row with no transport to smtp and carries no secret', () => {
		const p = toEmailProvider({ id: 'p1', name: 'Primary', host: 'smtp.example.test', port: 587, from_addr: 'a@b.c' });
		expect(p.transport).toBe('smtp');
		expect(p.host).toBe('smtp.example.test');
		expect('api_key' in p).toBe(false);
		expect('password' in p).toBe(false);
	});

	it('keeps the api fields and the maps as strings', () => {
		const p = toEmailProvider({
			id: 'p2',
			name: 'Custom',
			transport: 'api',
			api_base_url: 'https://api.example.test',
			api_headers: { Authorization: 'Bearer {{api_key}}', 'X-Num': 3 },
			api_webhook_event_map: { delivered: 'delivered', bounce: 'bounced_hard' },
		});
		expect(p.transport).toBe('api');
		expect(p.api_base_url).toBe('https://api.example.test');
		expect(p.api_headers).toEqual({ Authorization: 'Bearer {{api_key}}' });
		expect(p.api_webhook_event_map).toEqual({ delivered: 'delivered', bounce: 'bounced_hard' });
	});
});

describe('webhookPath', () => {
	it('names the api receiver for the row', () => {
		expect(webhookPath('p 1')).toBe('/api/v1/email/webhook/api/p%201');
	});
});

describe('email providers client', () => {
	it('lists the first page of the envelope', async () => {
		const { c, calls } = client({ data: [{ id: 'p1', name: 'A', transport: 'api', api_base_url: 'https://api.example.test' }], total: 1 });
		const rows = await listEmailProviders(c);
		expect(calls[0].url).toBe('/api/admin/email/providers?limit=100&offset=0');
		expect(rows.map((r) => r.transport)).toEqual(['api']);
	});

	it('posts, puts and deletes on the provider routes', async () => {
		const { c, calls } = client({ id: 'p1', name: 'A' });
		await createEmailProvider(c, { name: 'A', transport: 'api', from_addr: 'a@b.c', priority: 0, max_per_hour: 0, api_base_url: 'https://api.example.test', api_key: 'k' });
		await updateEmailProvider(c, 'p 1', { name: 'B' });
		await deleteEmailProvider(c, 'p 1');
		expect(calls.map((x) => `${x.method} ${x.url}`)).toEqual([
			'POST /api/admin/email/providers',
			'PUT /api/admin/email/providers/p%201',
			'DELETE /api/admin/email/providers/p%201',
		]);
		expect(calls[0].body).toMatchObject({ api_base_url: 'https://api.example.test', api_key: 'k' });
	});
});
