import { describe, expect, it, vi } from 'vitest';
import type { HttpClient } from '@lyeve-labs/client';
import { passkeysRemovedText, setUserPassword } from './users';

describe('setUserPassword', () => {
	it('puts the password to the account under the admin users routes', async () => {
		const put = vi.fn(async () => ({ id: 'u1', email: 'a@b.co', roles: ['editor'] }));
		const client = { put } as unknown as HttpClient;

		const user = await setUserPassword('u1', 'correct horse battery', client);

		expect(put).toHaveBeenCalledWith('/api/admin/users/u1/password', {
			password: 'correct horse battery',
			remove_passkeys: true,
		});
		expect(user.email).toBe('a@b.co');
	});

	// An id is a path segment, so one carrying a slash or a space has to be
	// escaped or the route it lands on is not the one asked for.
	it('escapes the id into its path segment', async () => {
		const put = vi.fn(async () => ({}));
		const client = { put } as unknown as HttpClient;

		await setUserPassword('a/b c', 'pw', client);

		expect(put).toHaveBeenCalledWith('/api/admin/users/a%2Fb%20c/password', { password: 'pw', remove_passkeys: true });
	});

	// The engine's refusal is the only thing that says what to change, so
	// the client passes it through untouched rather than wrapping it.
	it('keeps the passkeys when asked to', async () => {
		const put = vi.fn(async () => ({}));
		const client = { put } as unknown as HttpClient;

		await setUserPassword('u1', 'correct horse battery', client, false);

		expect(put).toHaveBeenCalledWith('/api/admin/users/u1/password', {
			password: 'correct horse battery',
			remove_passkeys: false,
		});
	});

	it('lets the engine refusal through', async () => {
		const refused = new Error('password must be at least 12 characters');
		const client = { put: vi.fn(async () => { throw refused; }) } as unknown as HttpClient;

		await expect(setUserPassword('u1', 'short', client)).rejects.toBe(refused);
	});
});

describe('passkeysRemovedText', () => {
	it('says how many passkeys a reset removed, and nothing when it removed none', () => {
		expect(passkeysRemovedText(0)).toBe('');
		expect(passkeysRemovedText(undefined)).toBe('');
		expect(passkeysRemovedText(1)).toBe('1 passkey was removed.');
		expect(passkeysRemovedText(3)).toBe('3 passkeys were removed.');
	});
});
