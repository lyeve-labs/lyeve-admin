import type { Actions, PageServerLoad } from './$types';
import { fail } from '@sveltejs/kit';
import { authedClient } from '$lib/server/authz';
import { actionError } from '$lib/server/action-error';

export const load: PageServerLoad = async ({ parent }) => {
	const { user } = await parent();
	return { user };
};

export const actions: Actions = {
	/**
	 * Issues a Bearer token the way an external app would get one: from an
	 * email and a password, with no session behind it. The call runs on the
	 * server, so a 5xx body never reaches the page as it was sent.
	 */
	// The request goes out through event.fetch, which forwards the session
	// cookie, so the engine applies its CSRF check and the token has to ride along.
	token: async (event) => {
		const form = await event.request.formData();
		const email = String(form.get('email') ?? '').trim();
		const password = String(form.get('password') ?? '');
		if (!email || !password) return fail(400, { tokenError: 'Enter the email and the password of the account.' });
		try {
			const r = await authedClient(event).post<{ token: string }>('/api/v1/auth/token', { email, password });
			return { token: r.token };
		} catch (err) {
			return fail(400, { tokenError: actionError(err, 'The token could not be issued.') });
		}
	},
};
