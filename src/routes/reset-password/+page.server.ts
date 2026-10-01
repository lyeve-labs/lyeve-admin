import { fail } from '@sveltejs/kit';
import { createClient } from '@lyeve-labs/client';
import { confirmPasswordReset, RESET_MIN_PASSWORD_LENGTH } from '$lib/api/password-reset';
import { recoveryRefusal } from '$lib/server/recovery';
import { checkRateLimit } from '$lib/server/rate-limit';
import type { Actions, PageServerLoad } from './$types';

const EXPIRED = 'This reset link is invalid or has expired. Request a new one.';

// The token is read here and only spent by the submit, so a mail scanner that
// opens the link leaves it usable.
export const load: PageServerLoad = ({ url }) => {
	return { token: url.searchParams.get('token') ?? '', minLength: RESET_MIN_PASSWORD_LENGTH };
};

export const actions: Actions = {
	default: async (event) => {
		const limit = checkRateLimit(event.getClientAddress());
		if (!limit.allowed) return fail(429, { error: 'Too many attempts. Please try again later.' });

		const form = await event.request.formData();
		const token = String(form.get('token') ?? '').trim();
		const password = String(form.get('password') ?? '');
		const confirm = String(form.get('confirm') ?? '');

		if (!token) return fail(400, { error: EXPIRED, expired: true });
		if (password.length < RESET_MIN_PASSWORD_LENGTH) {
			return fail(400, { error: `Use at least ${RESET_MIN_PASSWORD_LENGTH} characters.` });
		}
		if (password !== confirm) return fail(400, { error: 'The two passwords do not match.' });

		try {
			await confirmPasswordReset(createClient(event.fetch), token, password);
		} catch (e) {
			const refused = recoveryRefusal(e, 'Password reset');
			if (refused) return fail(refused.status, { error: refused.error });
			// The engine refuses a spent, expired or unknown token with the same
			// 400, and a password it finds too short the same way. The length is
			// checked above, so what is left is the link.
			return fail(400, { error: EXPIRED, expired: true });
		}
		return { done: true };
	},
};
