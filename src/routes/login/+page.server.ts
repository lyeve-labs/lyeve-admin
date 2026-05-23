import { redirect, fail } from '@sveltejs/kit';
import { authedClient } from '$lib/server/authz';
import type { PageServerLoad, Actions } from './$types';
import { createClient, ApiError } from '@lyeve-labs/client';
import { getMe, mfaVerify, isMFAChallenge, type LoginResponse } from '@lyeve-labs/client-rest';
import { checkRateLimit } from '$lib/server/rate-limit';
import { clearSessionCookie, setSessionCookie, sessionToken } from '$lib/server/session-cookie';
import { adminReturnPath } from '$lib/server/local-path';
import { LANDING } from '$lib/landing';
import { challengeFrom } from '$lib/captcha';

/**
 * The page a sign-in returns to: the `next` query when it is an admin page,
 * and the dashboard otherwise.
 */
function returnTo(url: URL | undefined): string {
	return adminReturnPath(url?.searchParams.get('next'), LANDING);
}

/**
 * Enabled provider names from one of the public sign-in routes.
 *
 * Both routes answer a bare array of objects carrying a name and nothing else,
 * because the login page is unauthenticated and a provider list is the most it
 * may learn. Anything other than a 200 is treated as "no providers": the
 * engine may refuse, and a login form that failed because a provider route
 * refused would lock out the password path as well.
 */
async function providerNames(
	fetch: typeof globalThis.fetch,
	url: string
): Promise<string[]> {
	try {
		const res = await fetch(url);
		if (!res.ok) return [];
		const data = (await res.json()) as { name?: string }[] | null;
		return (data ?? []).map((p) => p.name).filter((n): n is string => !!n);
	} catch {
		// The engine may not be up yet. The password form still has to render.
		return [];
	}
}

export const load: PageServerLoad = async (event) => {
	const { fetch, cookies } = event;

	// Already logged in, or only holding a cookie that says so? A session the
	// engine has revoked or expired still looks like one from here, and sending
	// its holder to /admin means bouncing straight back, forever. Ask the engine
	// before trusting it, and drop what it rejects so the form renders.
	const token = sessionToken(event);
	if (token) {
		const user = await getMe(authedClient(event)).catch(() => null);
		if (user) {
			redirect(302, returnTo(event.url));
		}
		clearSessionCookie(event);
	}

	// Sign-in buttons come from the plugins' own public routes. Either may
	// refuse, so a non-ok response means no button and never an error on the
	// form: somebody with a password must still be able to get in when SSO is
	// unavailable.
	const [oauthProviders, samlProviders] = await Promise.all([
		providerNames(fetch, '/api/admin/auth/oauth-providers'),
		providerNames(fetch, '/api/admin/auth/saml-providers'),
	]);

	return { oauthProviders, samlProviders };
};

export const actions: Actions = {
	default: async (event) => {
		const { request, fetch, cookies } = event;

		// Rate limit login attempts per IP to deter credential stuffing.
		const ip = event.getClientAddress();
		const limit = checkRateLimit(ip);
		if (!limit.allowed) {
			return fail(429, { error: 'Too many attempts. Please try again later.', retryAfterSec: limit.retryAfterSec });
		}

		const form = await request.formData();
		const challengeToken = form.get('challenge_token') as string | null;

		// Step 2: MFA verification
		if (challengeToken) {
			const code = form.get('code') as string;
			if (!code) return { error: 'Verification code is required.', mfa_required: true, challenge_token: challengeToken };
			try {
				const res = await mfaVerify(challengeToken, code, createClient(fetch));
				setSessionCookie(event, res.token);
			} catch (e) {
				// The engine returns 429 for both MFA lockout and challenge
				// exhaustion. Calling either an invalid code tells the user to
				// keep retrying the one thing that cannot work.
				if (e instanceof ApiError && e.status === 429) {
					return fail(429, {
						error: 'Too many verification attempts. Please wait before trying again.',
						mfa_required: true,
						challenge_token: challengeToken,
					});
				}
				return { error: 'Invalid code.', mfa_required: true, challenge_token: challengeToken };
			}
			redirect(302, returnTo(event.url));
		}

		// Step 1: Password login
		const email = form.get('email') as string;
		const password = form.get('password') as string;

		if (!email || !password) {
			return { error: 'Email and password are required.' };
		}

		// The captcha plugin reads the token from the login body itself, so it
		// travels beside the credentials rather than in a header. Absent until
		// the engine has asked for a challenge.
		const captchaToken = String(form.get('captcha_token') ?? '').trim();
		const body: Record<string, string> = { email, password };
		if (captchaToken) body.captcha_token = captchaToken;

		const client = createClient(fetch);
		try {
			const res = await client.post<LoginResponse>('/api/admin/auth/login', body);
			if (isMFAChallenge(res)) {
				// Return challenge token to trigger TOTP step in the UI.
				return { mfa_required: true, challenge_token: res.challenge_token };
			}
			setSessionCookie(event, res.token);
		} catch (e) {
			// Only a rejected credential should read as a rejected credential.
			// The engine rate-limits this endpoint at 5 attempts, and reporting
			// that as a bad password sends people to reset a password that was
			// never wrong. A 5xx reported the same way hides an outage.
			if (e instanceof ApiError) {
				// After repeated failures the engine asks for a challenge. A 400
				// carrying it means the token was missing or refused. A 401
				// carrying it means the password was wrong and the next attempt
				// has to pass the check as well. Either way the form has to show
				// the widget, or the user stays locked out for the whole window.
				const captcha = challengeFrom(e.body);
				if (captcha) {
					return fail(e.status === 401 ? 401 : 400, {
						error:
							e.status === 401
								? 'Invalid email or password. Complete the security check to try again.'
								: 'Complete the security check to sign in.',
						captcha,
						email,
					});
				}
				if (e.status === 429) {
					return fail(429, { error: 'Too many attempts. Please try again in a moment.' });
				}
				if (e.status >= 500) {
					return fail(e.status, { error: 'Sign-in is unavailable right now. Please try again shortly.' });
				}
			}
			return { error: 'Invalid email or password.' };
		}

		redirect(302, returnTo(event.url));
	},
};

