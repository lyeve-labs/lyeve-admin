import { describe, expect, it, vi } from 'vitest';
import type { Cookies } from '@sveltejs/kit';
import { clearSessionCookie, sessionCookieName, sessionToken, setSessionCookie } from './session-cookie';

function jar(values: Record<string, string> = {}): Cookies {
	return {
		get: vi.fn((name: string) => values[name]),
		set: vi.fn(),
		delete: vi.fn(),
		getAll: vi.fn(() => []),
		serialize: vi.fn(() => ''),
	} as unknown as Cookies;
}

const HTTPS = new URL('https://admin.example.com/admin');
const HTTP = new URL('http://localhost:5173/admin');

describe('session cookie over HTTPS', () => {
	it('is written as __Host-sys_session, Secure', () => {
		const cookies = jar();
		setSessionCookie({ cookies, url: HTTPS }, 'tok');
		expect(sessionCookieName({ cookies, url: HTTPS })).toBe('__Host-sys_session');
		expect(cookies.set).toHaveBeenCalledWith('__Host-sys_session', 'tok', expect.objectContaining({ path: '/', secure: true, httpOnly: true, sameSite: 'strict' }));
	});

	it('is read only under the prefixed name', () => {
		expect(sessionToken({ cookies: jar({ '__Host-sys_session': 'good' }), url: HTTPS })).toBe('good');
		// A plain sys_session can be planted by any host on the parent domain.
		expect(sessionToken({ cookies: jar({ sys_session: 'planted' }), url: HTTPS })).toBeUndefined();
	});

	it('is cleared with Secure, or the browser ignores the delete', () => {
		const cookies = jar({ '__Host-sys_session': 'tok' });
		clearSessionCookie({ cookies, url: HTTPS });
		expect(cookies.delete).toHaveBeenCalledWith('__Host-sys_session', expect.objectContaining({ path: '/', secure: true }));
		expect(cookies.delete).toHaveBeenCalledTimes(1);
	});
});

describe('session cookie over plain HTTP', () => {
	it('is written as sys_session, without Secure', () => {
		const cookies = jar();
		setSessionCookie({ cookies, url: HTTP }, 'tok');
		expect(cookies.set).toHaveBeenCalledWith('sys_session', 'tok', expect.objectContaining({ path: '/', secure: false, httpOnly: true }));
	});

	it('prefers the plain name and also reads a prefixed one the browser kept', () => {
		expect(sessionToken({ cookies: jar({ sys_session: 'new', '__Host-sys_session': 'old' }), url: HTTP })).toBe('new');
		expect(sessionToken({ cookies: jar({ '__Host-sys_session': 'old' }), url: HTTP })).toBe('old');
		expect(sessionToken({ cookies: jar(), url: HTTP })).toBeUndefined();
	});

	it('clears both names, so a leftover prefixed cookie cannot revive the session', () => {
		const cookies = jar({ sys_session: 'new', '__Host-sys_session': 'old' });
		clearSessionCookie({ cookies, url: HTTP });
		expect(cookies.delete).toHaveBeenCalledWith('sys_session', expect.objectContaining({ path: '/', secure: false }));
		expect(cookies.delete).toHaveBeenCalledWith('__Host-sys_session', expect.objectContaining({ path: '/', secure: true }));
	});
});
