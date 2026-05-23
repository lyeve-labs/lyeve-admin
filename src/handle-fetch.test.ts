import { describe, it, expect, vi } from 'vitest';

const KEY = '0123456789abcdef0123456789abcdef';

vi.hoisted(() => {
	process.env.ADMIN_CONSOLE_KEY = '0123456789abcdef0123456789abcdef';
	process.env.CORE_INTERNAL_URL = 'http://engine.internal:3001';
});
vi.mock('$app/environment', () => ({ dev: false }));

import { handleFetch } from './hooks.server';
import {
	CONSOLE_CLIENT_HEADER,
	CONSOLE_SIGNATURE_HEADER,
	CONSOLE_TIME_HEADER,
	consoleSignature
} from '$lib/server/engine';

async function call(url: string, headers: Record<string, string> = {}): Promise<Request> {
	const sent: Request[] = [];
	const fetch = vi.fn(async (req: Request) => {
		sent.push(req);
		return new Response(null, { status: 204 });
	});
	const event = {
		url: new URL('https://admin.example.com/admin/users'),
		getClientAddress: () => '203.0.113.9'
	};
	await handleFetch({
		request: new Request(url, { headers }),
		fetch,
		event
	} as unknown as Parameters<typeof handleFetch>[0]);
	return sent[0];
}

describe('handleFetch', () => {
	it('sends an engine call to the engine, signed for the browser', async () => {
		const req = await call('https://admin.example.com/api/admin/users?page=2', {
			Authorization: 'Bearer abc'
		});
		expect(req.url).toBe('http://engine.internal:3001/api/admin/users?page=2');
		expect(req.headers.get(CONSOLE_CLIENT_HEADER)).toBe('203.0.113.9');
		const stamp = req.headers.get(CONSOLE_TIME_HEADER) ?? '';
		expect(req.headers.get(CONSOLE_SIGNATURE_HEADER)).toBe(
			consoleSignature(KEY, stamp, 'GET', '/api/admin/users', 'page=2', '203.0.113.9', 'Bearer abc')
		);
	});

	it('replaces console headers the browser sent with its own', async () => {
		const req = await call('https://admin.example.com/api/admin/users', {
			[CONSOLE_CLIENT_HEADER]: '198.51.100.1',
			[CONSOLE_SIGNATURE_HEADER]: 'forged'
		});
		expect(req.headers.get(CONSOLE_CLIENT_HEADER)).toBe('203.0.113.9');
		expect(req.headers.get(CONSOLE_SIGNATURE_HEADER)).not.toBe('forged');
	});

	it('leaves a call to another origin alone', async () => {
		const req = await call('https://elsewhere.example.net/api/items');
		expect(req.url).toBe('https://elsewhere.example.net/api/items');
		expect(req.headers.has(CONSOLE_CLIENT_HEADER)).toBe(false);
		expect(req.headers.has(CONSOLE_SIGNATURE_HEADER)).toBe(false);
	});

	it('leaves a non-api call alone', async () => {
		const req = await call('https://admin.example.com/robots.txt');
		expect(req.url).toBe('https://admin.example.com/robots.txt');
		expect(req.headers.has(CONSOLE_SIGNATURE_HEADER)).toBe(false);
	});

	it('passes the engine\'s CSRF cookie on to the browser', async () => {
		const set = vi.fn();
		const fetch = vi.fn(async () => {
			const headers = new Headers();
			headers.append('Set-Cookie', '__Host-sys_session=jwt; Path=/; HttpOnly; Secure; SameSite=Strict');
			headers.append('Set-Cookie', '__Host-csrf=pair; Path=/; Max-Age=900; Secure; SameSite=Strict');
			return new Response('{}', { status: 200, headers });
		});
		await handleFetch({
			request: new Request('https://admin.example.com/api/admin/auth/login', { method: 'POST' }),
			fetch,
			event: {
				url: new URL('https://admin.example.com/login'),
				getClientAddress: () => '203.0.113.9',
				cookies: { set }
			}
		} as unknown as Parameters<typeof handleFetch>[0]);
		expect(set).toHaveBeenCalledTimes(1);
		expect(set).toHaveBeenCalledWith('__Host-csrf', 'pair', expect.objectContaining({ path: '/', secure: true }));
	});
});
