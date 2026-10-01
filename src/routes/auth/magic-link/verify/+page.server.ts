import { fail, redirect } from '@sveltejs/kit';
import { ApiError, createClient } from '@lyeve-labs/client';
import { mfaVerify } from '@lyeve-labs/client-rest';
import { isMagicLinkMFAChallenge, verifyMagicLink } from '$lib/api/magic-link';
import { recoveryRefusal } from '$lib/server/recovery';
import { checkRateLimit } from '$lib/server/rate-limit';
import { setSessionCookie } from '$lib/server/session-cookie';
import { LANDING } from '$lib/landing';
import type { Actions, PageServerLoad } from './$types';

const EXPIRED = 'This sign-in link is invalid or has expired. Request a new one.';

// Opening the link only shows a button. Redeeming spends the token, and a mail
// scanner that fetches every link in a message would spend it before the
// person ever clicked, so the redemption waits for a submit.
export const load: PageServerLoad = ({ url }) => {
	return { token: url.searchParams.get('token') ?? '' };
};

export const actions: Actions = {
	verify: async (event) => {
		const limit = checkRateLimit(event.getClientAddress());
		if (!limit.allowed) return fail(429, { error: 'Too many attempts. Please try again later.' });

		const form = await event.request.formData();
		const token = String(form.get('token') ?? '').trim();
		if (!token) return fail(400, { error: EXPIRED });

		try {
			const res = await verifyMagicLink(createClient(event.fetch), token);
			if (isMagicLinkMFAChallenge(res)) {
				return { mfa_required: true, challenge_token: res.challenge_token };
			}
			setSessionCookie(event, res.access_token);
		} catch (e) {
			const refused = recoveryRefusal(e, 'Email sign-in');
			if (refused) return fail(refused.status, { error: refused.error });
			return fail(400, { error: EXPIRED });
		}
		redirect(303, LANDING);
	},

	mfa: async (event) => {
		const limit = checkRateLimit(event.getClientAddress());
		if (!limit.allowed) return fail(429, { error: 'Too many attempts. Please try again later.' });

		const form = await event.request.formData();
		const challengeToken = String(form.get('challenge_token') ?? '');
		const code = String(form.get('code') ?? '').trim();
		if (!challengeToken) return fail(400, { error: EXPIRED });
		if (!code) {
			return fail(400, { error: 'Verification code is required.', mfa_required: true, challenge_token: challengeToken });
		}

		try {
			const res = await mfaVerify(challengeToken, code, createClient(event.fetch));
			setSessionCookie(event, res.token);
		} catch (e) {
			if (e instanceof ApiError && e.status === 429) {
				return fail(429, {
					error: 'Too many verification attempts. Please wait before trying again.',
					mfa_required: true,
					challenge_token: challengeToken,
				});
			}
			return fail(400, { error: 'Invalid code.', mfa_required: true, challenge_token: challengeToken });
		}
		redirect(303, LANDING);
	},
};
