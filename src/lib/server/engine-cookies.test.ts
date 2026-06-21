import { describe, expect, it, vi } from 'vitest';
import type { Cookies } from '@sveltejs/kit';
import { parseSetCookie, relayEngineCookies } from './engine-cookies';

function jar(): Cookies {
	return { get: vi.fn(), set: vi.fn(), delete: vi.fn(), getAll: vi.fn(() => []), serialize: vi.fn(() => '') } as unknown as Cookies;
}

function engineHeaders(...cookies: string[]): Headers {
	const headers = new Headers();
	for (const c of cookies) headers.append('Set-Cookie', c);
	return headers;
}

describe('parseSetCookie', () => {
	it('reads the attributes the engine sends and drops Domain', () => {
		expect(parseSetCookie('__Host-csrf=abc-123; Path=/; Max-Age=900; Domain=example.com; Secure; SameSite=Strict')).toEqual({
			name: '__Host-csrf',
			value: 'abc-123',
			path: '/',
			maxAge: 900,
			httpOnly: false,
			secure: true,
			sameSite: 'strict',
		});
	});

	it('refuses a header with no name', () => {
		expect(parseSetCookie('=x; Path=/')).toBeNull();
	});
});

describe('relayEngineCookies', () => {
	it('hands the browser the CSRF cookie the engine set at sign-in', () => {
		const cookies = jar();
		relayEngineCookies(
			engineHeaders(
				'__Host-sys_session=jwt; Path=/; Max-Age=900; HttpOnly; Secure; SameSite=Strict',
				'__Host-csrf=pair; Path=/; Max-Age=900; Secure; SameSite=Strict',
			),
			cookies,
		);
		expect(cookies.set).toHaveBeenCalledTimes(1);
		expect(cookies.set).toHaveBeenCalledWith('__Host-csrf', 'pair', expect.objectContaining({ path: '/', maxAge: 900, secure: true, httpOnly: false, sameSite: 'strict' }));
	});

	it('relays the plain-HTTP name and a logout that clears it', () => {
		const cookies = jar();
		relayEngineCookies(engineHeaders('csrf=; Path=/; Max-Age=0; SameSite=Strict'), cookies);
		expect(cookies.set).toHaveBeenCalledWith('csrf', '', expect.objectContaining({ maxAge: 0, secure: false }));
	});

	it('keeps answering when the response has already started', () => {
		const cookies = jar();
		vi.mocked(cookies.set).mockImplementation(() => {
			throw new Error('Cannot use cookies.set(...) after the response has been generated');
		});
		expect(() => relayEngineCookies(engineHeaders('__Host-csrf=pair; Path=/'), cookies)).not.toThrow();
	});
});
