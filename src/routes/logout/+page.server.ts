import { redirect } from '@sveltejs/kit';
import type { Actions } from './$types';
import { createClient } from '@lyeve-labs/client';
import { logout } from '@lyeve-labs/client-rest';
import { clearSessionCookie, sessionToken } from '$lib/server/session-cookie';

export const actions: Actions = {
	default: async ({ cookies, fetch, url }) => {
		const token = sessionToken({ cookies, url });
		if (token) {
			// Best-effort server-side session revocation so a stolen token does not
			// remain valid after logout. Cookie is cleared regardless.
			const client = createClient((url, init) =>
				fetch(url, {
					...init,
					headers: { ...init?.headers, Authorization: `Bearer ${token}` },
				})
			);
			await logout(client).catch(() => {});
		}
		clearSessionCookie({ cookies, url });
		redirect(302, '/login');
	},
};
