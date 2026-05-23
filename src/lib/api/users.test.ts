import { describe, expect, it, vi } from 'vitest';
import type { HttpClient } from '@lyeve-labs/client';
import { setUserPassword } from './users';

describe('setUserPassword', () => {
	it('puts the password to the account under the admin users routes', async () => {
		const put = vi.fn(async () => ({ id: 'u1', email: 'a@b.co', roles: ['editor'] }));
		const client = { put } as unknown as HttpClient;

		const user = await setUserPassword('u1', 'correct horse battery', client);

		expect(put).toHaveBeenCalledWith('/api/admin/users/u1/password', {
			password: 'correct horse battery',
		});
		expect(user.email).toBe('a@b.co');
	});

	// An id is a path segment, so one carrying a slash or a space has to be
	// escaped or the route it lands on is not the one asked for.
	it('escapes the id into its path segment', async () => {
		const put = vi.fn(async () => ({}));
		const client = { put } as unknown as HttpClient;

		await setUserPassword('a/b c', 'pw', client);

		expect(put).toHaveBeenCalledWith('/api/admin/users/a%2Fb%20c/password', { password: 'pw' });
	});

	// The engine's refusal is the only thing that says what to change, so
	// the client passes it through untouched rather than wrapping it.
	it('lets the engine refusal through', async () => {
		const refused = new Error('password must be at least 12 characters');
		const client = { put: vi.fn(async () => { throw refused; }) } as unknown as HttpClient;

		await expect(setUserPassword('u1', 'short', client)).rejects.toBe(refused);
	});
});
