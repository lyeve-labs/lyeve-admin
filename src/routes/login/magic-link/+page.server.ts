import { fail } from '@sveltejs/kit';
import { createClient } from '@lyeve-labs/client';
import { requestMagicLink } from '$lib/api/magic-link';
import { recoveryRefusal } from '$lib/server/recovery';
import { checkRateLimit } from '$lib/server/rate-limit';
import type { Actions } from './$types';

export const actions: Actions = {
	default: async (event) => {
		const limit = checkRateLimit(event.getClientAddress());
		if (!limit.allowed) {
			return fail(429, { error: 'Too many attempts. Please try again later.', email: '' });
		}

		const form = await event.request.formData();
		const email = String(form.get('email') ?? '').trim();
		if (!email) return fail(400, { error: 'Enter the email address you sign in with.', email });

		try {
			await requestMagicLink(createClient(event.fetch), email);
		} catch (e) {
			const refused = recoveryRefusal(e, 'Email sign-in');
			if (refused) return fail(refused.status, { error: refused.error, email });
			return fail(400, { error: 'Enter a valid email address.', email });
		}
		// The engine answers the same whether or not the address has an
		// account, and so does this page.
		return { sent: true, email };
	},
};
