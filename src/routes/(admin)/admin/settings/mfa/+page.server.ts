import type { Actions, PageServerLoad } from './$types';
import { fail } from '@sveltejs/kit';
import { ApiError } from '@lyeve-labs/client';
import { authedClient } from '$lib/server/authz';
import { actionFailure } from '$lib/server/action-error';
import { section } from '$lib/api/gate';

type Setup = { provisioning_uri: string; secret: string };

/**
 * The console's sentence for a setup the engine refused because the account
 * already holds a second factor and the request did not prove it. `byPasskey`
 * says which proof was sent, so a refused passkey is not called a wrong code.
 * Any other failure is not this refusal and gets undefined.
 */
function proofRefusal(err: unknown, byPasskey: boolean): { status: number; error: string } | undefined {
	if (!(err instanceof ApiError)) return undefined;
	const code = (err.body as { code?: unknown } | undefined)?.code;
	if (err.status === 400 && code === 'mfa.totp.current_code_required') {
		return {
			status: 400,
			error: 'This account already has a second factor. Confirm it with a passkey, a current code from the authenticator app or a backup code first.',
		};
	}
	if (err.status === 422 && code === 'mfa.totp.current_code_invalid') {
		return byPasskey
			? { status: 400, error: 'The passkey did not confirm a second factor on this account. Try again, or enter a code instead.' }
			: { status: 400, error: 'That code matches no second factor on this account.' };
	}
	return undefined;
}

/** The engine's answer to a passkey proof begin: the challenge to sign. */
type ProofBegin = { session_id: string; options: unknown };

export const load: PageServerLoad = async (event) => {
	// An unread status is unknown, never off: drawn as off it offers to turn on
	// a second factor the account may already have.
	//
	// The plugin reports enabled for a passkey as well as for an authenticator
	// app, and says nothing about the app while a passkey is registered. The
	// page keeps the two apart so it never offers to turn off an app that may
	// not be set up.
	const mfa = await section(
		authedClient(event)
			.get<{ enabled: boolean; has_passkeys?: boolean }>('/api/admin/mfa/status')
			.then((s) => ({ enabled: s.enabled === true, hasPasskeys: s.has_passkeys === true })),
		'The two-factor state of this account could not be read. This is not a report that it is off.'
	);
	return { mfa };
};

/**
 * The enrollment runs through the server so the engine's answer is read in one
 * place, and a 5xx body never reaches the operator as the error.
 */
export const actions: Actions = {
	// A passkey proof starts with a challenge the engine issues for that use
	// alone. The browser signs it, and the setup that follows spends it.
	prove: async (event) => {
		try {
			const p = await authedClient(event).post<ProofBegin>('/api/admin/mfa/proof/begin', {});
			return { step: 'proving' as const, proofSessionId: p.session_id, options: p.options };
		} catch (err) {
			if (err instanceof ApiError && err.status === 404) {
				return fail(404, { step: 'idle' as const, error: 'No passkey is registered on this account. Enter a code instead.' });
			}
			const failed = actionFailure(err, 'The passkey check could not be started.');
			return fail(failed.status, { step: 'idle' as const, ...failed.data });
		}
	},

	// Adding an authenticator app to an account that already holds a second
	// factor takes proof of one: a passkey assertion, a current code from the
	// app or a backup code. The engine refuses the setup without it. A first
	// factor takes no proof, so an empty form sends none.
	setup: async (event) => {
		const form = await event.request.formData();
		const code = String(form.get('code') ?? '').trim();
		const proofSessionId = String(form.get('proof_session_id') ?? '');
		const assertion = String(form.get('assertion') ?? '');
		let body: Record<string, unknown> = code ? { code } : {};
		if (proofSessionId && assertion) {
			try {
				body = { proof_session_id: proofSessionId, assertion: JSON.parse(assertion) };
			} catch {
				return fail(400, { step: 'idle' as const, error: 'The passkey answer could not be read. Try again, or enter a code instead.' });
			}
		}
		try {
			const s = await authedClient(event).post<Setup>('/api/admin/mfa/totp/setup', body);
			return { step: 'confirming' as const, uri: s.provisioning_uri, secret: s.secret };
		} catch (err) {
			const refused = proofRefusal(err, 'proof_session_id' in body);
			if (refused) return fail(refused.status, { step: 'idle' as const, error: refused.error });
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
			// A key set up before the account held a second factor never
			// activates, so the operator starts the setup again from the top.
			if (err instanceof ApiError && err.status === 409 && (err.body as { code?: unknown } | undefined)?.code === 'mfa.totp.setup_unproven') {
				return fail(409, { step: 'idle' as const, error: 'This setup started before the account had a second factor. Start the setup again.' });
			}
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
			// The plugin answers 400 when no authenticator app is set up, which
			// on an account with a passkey the status could not say.
			if (err instanceof ApiError && err.status === 400 && /not enabled/i.test(err.message)) {
				return fail(400, { step: 'idle' as const, error: 'No authenticator app is set up on this account, so there is nothing to turn off.' });
			}
			const failed = actionFailure(err, 'Two-factor authentication could not be turned off.');
			return fail(failed.status, { step: 'idle' as const, ...failed.data });
		}
	},
};
