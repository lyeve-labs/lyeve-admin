import type { Actions, PageServerLoad } from './$types';
import { fail } from '@sveltejs/kit';
import { authedClient } from '$lib/server/authz';
import { actionFailure } from '$lib/server/action-error';

type Setup = { provisioning_uri: string; secret: string };

export const load: PageServerLoad = async (event) => {
	const status = await authedClient(event)
		.get<{ enabled: boolean }>('/api/admin/mfa/status')
		.catch(() => ({ enabled: false }));
	return { mfaEnabled: status.enabled };
};

/**
 * The enrollment runs through the server so the engine's answer is read in one
 * place, and a 5xx body never reaches the operator as the error.
 */
export const actions: Actions = {
	setup: async (event) => {
		try {
			const s = await authedClient(event).post<Setup>('/api/admin/mfa/totp/setup', {});
			return { step: 'confirming' as const, uri: s.provisioning_uri, secret: s.secret };
		} catch (err) {
			const failed = actionFailure(err, 'The authenticator key could not be generated.');
			return fail(failed.status, { step: 'idle' as const, ...failed.data });
		}
	},

	// A wrong code leaves the operator on the QR step with the same key, so the
	// key travels with the form rather than being generated again.
	verify: async (event) => {
		const form = await event.request.formData();
		const code = String(form.get('code') ?? '').trim();
		const uri = String(form.get('uri') ?? '');
		const secret = String(form.get('secret') ?? '');
		if (!/^\d{6}$/.test(code)) {
			return fail(400, { step: 'confirming' as const, uri, secret, error: 'Enter the 6-digit code from the app.' });
		}
		try {
			const r = await authedClient(event).post<{ backup_codes: string[] }>('/api/admin/mfa/totp/verify', { code });
			return { step: 'done' as const, backupCodes: r.backup_codes ?? [] };
		} catch (err) {
			const failed = actionFailure(err, 'The code could not be checked.');
			return fail(failed.status, { step: 'confirming' as const, uri, secret, ...failed.data });
		}
	},

	disable: async (event) => {
		const form = await event.request.formData();
		const code = String(form.get('code') ?? '').trim();
		if (!code) return fail(400, { step: 'idle' as const, error: 'Enter a current code or a backup code.' });
		try {
			await authedClient(event).post('/api/admin/mfa/totp/disable', { code });
			return { step: 'idle' as const, disabled: true };
		} catch (err) {
			const failed = actionFailure(err, 'Two-factor authentication could not be turned off.');
			return fail(failed.status, { step: 'idle' as const, ...failed.data });
		}
	},
};
