import { describe, it, expect } from 'vitest';
import {
	CONSOLE_CLIENT_HEADER,
	CONSOLE_HOST_HEADER,
	CONSOLE_HOST_SIGNATURE_HEADER,
	CONSOLE_SIGNATURE_HEADER,
	CONSOLE_TIME_HEADER,
	callerOf,
	clientAddressOf,
	consoleHostSignature,
	consoleSignature,
	contentApiAddressProblem,
	signEngineRequest
} from './engine';

const KEY = '0123456789abcdef0123456789abcdef';

describe('consoleSignature', () => {
	// The engine asserts the same vector, so the two sides cannot drift apart.
	it('matches the engine for a known request', () => {
		expect(
			consoleSignature(
				KEY,
				'1800000000',
				'POST',
				'/api/admin/auth/login',
				'next=%2Fadmin',
				'203.0.113.9',
				'Bearer abc'
			)
		).toBe('e636068bed4b46f4db44b56c6efd2225e270af6419bd67b04c6366afbd27e761');
	});
});

describe('consoleHostSignature', () => {
	// The engine asserts the same vector.
	it('matches the engine for a known host', () => {
		expect(
			consoleHostSignature(KEY, '1800000000', 'e636068bed4b46f4db44b56c6efd2225e270af6419bd67b04c6366afbd27e761', 'acme.example.com')
		).toBe('50560ffb0df4706696ea4f6aa08d1602c62f0eb79375c25de9e6a52594868c1e');
	});
});

describe('signEngineRequest', () => {
	const url = new URL('http://engine/api/admin/auth/login?next=%2Fadmin');

	it('names the client and signs the request', () => {
		const headers = new Headers({ Authorization: 'Bearer abc' });
		signEngineRequest(headers, 'post', url, { address: '203.0.113.9' }, KEY, 1_800_000_000_500);
		expect(headers.get(CONSOLE_CLIENT_HEADER)).toBe('203.0.113.9');
		expect(headers.get(CONSOLE_TIME_HEADER)).toBe('1800000000');
		expect(headers.get(CONSOLE_SIGNATURE_HEADER)).toBe(
			'e636068bed4b46f4db44b56c6efd2225e270af6419bd67b04c6366afbd27e761'
		);
	});

	// The proxy in front of the engine may re-escape the path, so the decoded
	// form is what both sides sign.
	it('signs the decoded path', () => {
		const raw = new Headers();
		signEngineRequest(raw, 'GET', new URL('http://engine/api/admin/content/%C3%A9t%C3%A9?tag=%C3%A9'), { address: '203.0.113.9' }, KEY, 1_800_000_000_000);
		expect(raw.get(CONSOLE_SIGNATURE_HEADER)).toBe(
			consoleSignature(KEY, '1800000000', 'GET', '/api/admin/content/été', 'tag=%C3%A9', '203.0.113.9', '')
		);
	});

	it('drops console headers a browser sent, even with no key', () => {
		const headers = new Headers({
			[CONSOLE_CLIENT_HEADER]: '198.51.100.1',
			[CONSOLE_TIME_HEADER]: '1',
			[CONSOLE_SIGNATURE_HEADER]: 'forged',
			[CONSOLE_HOST_HEADER]: 'evil.example.com',
			[CONSOLE_HOST_SIGNATURE_HEADER]: 'forged'
		});
		signEngineRequest(headers, 'GET', url, { address: '203.0.113.9', host: 'acme.example.com' }, '');
		expect(headers.has(CONSOLE_CLIENT_HEADER)).toBe(false);
		expect(headers.has(CONSOLE_TIME_HEADER)).toBe(false);
		expect(headers.has(CONSOLE_SIGNATURE_HEADER)).toBe(false);
		expect(headers.has(CONSOLE_HOST_HEADER)).toBe(false);
		expect(headers.has(CONSOLE_HOST_SIGNATURE_HEADER)).toBe(false);
	});

	// The engine resolves a tenant from the host before sign-in, and it is
	// reached at an internal address, so the host the browser opened travels
	// signed beside the request.
	it('vouches for the host the browser opened', () => {
		const headers = new Headers({ Authorization: 'Bearer abc' });
		signEngineRequest(headers, 'post', url, { address: '203.0.113.9', host: 'acme.example.com' }, KEY, 1_800_000_000_500);
		expect(headers.get(CONSOLE_SIGNATURE_HEADER)).toBe(
			'e636068bed4b46f4db44b56c6efd2225e270af6419bd67b04c6366afbd27e761'
		);
		expect(headers.get(CONSOLE_HOST_HEADER)).toBe('acme.example.com');
		expect(headers.get(CONSOLE_HOST_SIGNATURE_HEADER)).toBe(
			'50560ffb0df4706696ea4f6aa08d1602c62f0eb79375c25de9e6a52594868c1e'
		);
	});

	it('names no host when it does not know one', () => {
		const headers = new Headers();
		signEngineRequest(headers, 'GET', url, { address: '203.0.113.9' }, KEY);
		expect(headers.has(CONSOLE_SIGNATURE_HEADER)).toBe(true);
		expect(headers.has(CONSOLE_HOST_HEADER)).toBe(false);
	});

	it('signs nothing when the address is unknown', () => {
		const headers = new Headers();
		signEngineRequest(headers, 'GET', url, { address: '', host: 'acme.example.com' }, KEY);
		expect(headers.has(CONSOLE_SIGNATURE_HEADER)).toBe(false);
	});
});

describe('callerOf', () => {
	it('names the address and the host the browser opened', () => {
		expect(callerOf({ getClientAddress: () => '203.0.113.9', url: new URL('https://acme.example.com/login') })).toEqual({
			address: '203.0.113.9',
			host: 'acme.example.com'
		});
		expect(callerOf({ getClientAddress: () => '203.0.113.9' })).toEqual({ address: '203.0.113.9', host: undefined });
	});
});

describe('clientAddressOf', () => {
	it('answers empty when the adapter cannot tell', () => {
		expect(
			clientAddressOf({
				getClientAddress: () => {
					throw new Error('no address');
				}
			})
		).toBe('');
	});
});

/*
 * The official image listens on 3002, which is also the fallback Content API
 * address, so an unset variable would send every /api/v1 call back to this
 * console.
 */
describe('contentApiAddressProblem', () => {
	const image = { PORT: '3002', HOST: '0.0.0.0' };

	it('refuses an unset or blank address', () => {
		expect(contentApiAddressProblem(image, 'a1b2c3')).toMatch(/CORE_API_INTERNAL_URL is unset/);
		expect(contentApiAddressProblem({ ...image, CORE_API_INTERNAL_URL: '  ' }, 'a1b2c3')).toMatch(
			/is unset/
		);
	});

	it('refuses the fallback inside the image, which is this console', () => {
		for (const addr of [
			'http://localhost:3002',
			'http://127.0.0.1:3002',
			'http://[::1]:3002',
			'http://0.0.0.0:3002/',
			'http://a1b2c3:3002'
		]) {
			expect(
				contentApiAddressProblem({ ...image, CORE_API_INTERNAL_URL: addr }, 'a1b2c3'),
				addr
			).toMatch(/is this console, which listens on port 3002/);
		}
	});

	it('reads the port adapter-node defaults to when PORT is unset', () => {
		expect(
			contentApiAddressProblem({ CORE_API_INTERNAL_URL: 'http://localhost:3000' }, 'h')
		).toMatch(/port 3000/);
		expect(
			contentApiAddressProblem({ CORE_API_INTERNAL_URL: 'http://localhost:3002' }, 'h')
		).toBeNull();
	});

	it('refuses what is not an http address', () => {
		expect(
			contentApiAddressProblem({ ...image, CORE_API_INTERNAL_URL: 'traefik:8081' }, 'h')
		).toMatch(/must be http or https/);
		expect(contentApiAddressProblem({ ...image, CORE_API_INTERNAL_URL: '::' }, 'h')).toMatch(
			/is not a URL/
		);
	});

	it('accepts a proxy, an engine host, or this console behind an ingress', () => {
		for (const addr of [
			'http://traefik:8081',
			'http://core:3002',
			'http://localhost:3001',
			'https://cms.example.com'
		]) {
			expect(contentApiAddressProblem({ ...image, CORE_API_INTERNAL_URL: addr }, 'a1b2c3'), addr).toBeNull();
		}
	});
});
