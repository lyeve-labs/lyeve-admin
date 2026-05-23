import { redirect, fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { createClient, ApiError } from '@lyeve-labs/client';
import { checkRateLimit } from '$lib/server/rate-limit';
import { claimSetup, getSetupModeStatus } from '$lib/api/setup';
import { readEngineSetup, safeNext } from '$lib/server/setup-gate';
import { LANDING } from '$lib/landing';
import { setSessionCookie } from '$lib/server/session-cookie';

export const load: PageServerLoad = async ({ fetch, url }) => {
	const next = safeNext(url.searchParams.get('next'));
	const read = await readEngineSetup(fetch);
	if (read.state === 'ready') {
		redirect(303, next ?? '/login');
	}
	// A rate-limited engine cannot say where setup stands. The screen shows it
	// as not answering yet and polls until it does.
	const state = read.state === 'busy' ? 'unreachable' : read.state;
	return { state, tokenSource: read.tokenSource, next };
};

const TOKEN_REFUSED =
	'The engine did not accept that setup token. Copy it again from the place named under the field.';

function limited(ip: string) {
	const limit = checkRateLimit(ip);
	return limit.allowed
		? null
		: fail(429, { error: 'Too many attempts. Please try again later.', retryAfterSec: limit.retryAfterSec });
}

export const actions: Actions = {
	// Reads what an engine in setup mode is missing. The generated secrets come
	// back on the first read only, so they live in this action's result and in
	// nothing the admin stores.
	status: async (event) => {
		const refused = limited(event.getClientAddress());
		if (refused) return refused;

		const form = await event.request.formData();
		const setupToken = String(form.get('setup_token') ?? '').trim();
		if (!setupToken) {
			return fail(400, { error: 'The setup token is required.' });
		}
		try {
			const status = await getSetupModeStatus(setupToken, createClient(event.fetch));
			return { status };
		} catch (err) {
			if (err instanceof ApiError && err.status === 401) {
				return fail(401, { error: TOKEN_REFUSED });
			}
			if (err instanceof ApiError && err.status === 404) {
				// Not in setup mode any more: the engine restarted with its
				// settings. The next load shows the step that applies.
				return { status: null };
			}
			return fail(503, { error: 'The engine did not answer. It may be restarting; try again in a moment.' });
		}
	},

	create: async (event) => {
		const { request, fetch } = event;

		// Setup is one-shot per instance, so repeated POSTs are almost
		// certainly abuse.
		const refused = limited(event.getClientAddress());
		if (refused) return refused;

		const form = await request.formData();
		const email = form.get('email') as string;
		const password = form.get('password') as string;
		const confirm = form.get('confirm') as string;
		const setupToken = String(form.get('setup_token') ?? '').trim();

		if (!setupToken) {
			return { error: 'The setup token is required.' };
		}
		if (!email || !password) {
			return { error: 'Email and password are required.' };
		}
		if (password !== confirm) {
			return { error: 'Passwords do not match.' };
		}
		if (password.length < 8) {
			return { error: 'Password must be at least 8 characters.' };
		}

		const client = createClient(fetch);
		try {
			const res = await claimSetup({ email, password, setup_token: setupToken }, client);
			setSessionCookie(event, res.token);
		} catch (err) {
			if (err instanceof ApiError && err.status === 401) {
				return fail(401, { error: TOKEN_REFUSED });
			}
			if (err instanceof ApiError && err.status === 409) {
				redirect(303, '/login');
			}
			return { error: 'Setup failed.' };
		}

		redirect(303, LANDING);
	},
};
