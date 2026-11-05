import { describe, expect, it, vi } from 'vitest';
import type { HttpClient } from '@lyeve-labs/client';
import { confirmPasswordReset } from './password-reset';

describe('confirmPasswordReset', () => {
	it('sends the choice to remove the passkeys with the token and the password', async () => {
		const post = vi.fn(async () => ({ message: 'ok', passkeys_removed: 2 }));
		const client = { post } as unknown as HttpClient;

		const answer = await confirmPasswordReset(client, 't1', 'correct horse battery', true);

		expect(post).toHaveBeenCalledWith('/api/admin/auth/password-reset/confirm', {
			token: 't1',
			password: 'correct horse battery',
			remove_passkeys: true,
		});
		expect(answer.passkeys_removed).toBe(2);
	});

	it('sends a choice to keep the passkeys as false, never as an absent field', async () => {
		const post = vi.fn(async () => ({ message: 'ok' }));
		const client = { post } as unknown as HttpClient;

		await confirmPasswordReset(client, 't1', 'correct horse battery', false);

		expect(post).toHaveBeenCalledWith('/api/admin/auth/password-reset/confirm', {
			token: 't1',
			password: 'correct horse battery',
			remove_passkeys: false,
		});
	});
});
