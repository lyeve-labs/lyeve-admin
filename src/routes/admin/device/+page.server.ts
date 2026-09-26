import { fail, redirect } from '@sveltejs/kit';
import { ApiError } from '@lyeve-labs/client';
import { getMe } from '@lyeve-labs/client-rest';
import { authedClient } from '$lib/server/authz';
import { clearSessionCookie, sessionToken } from '$lib/server/session-cookie';
import {
	approveDeviceLogin,
	denyDeviceLogin,
	getDeviceLogin,
	type DeviceLoginRequest,
	type DeviceStepUp,
} from '$lib/api/device-login';
import { describeRefusal } from '$lib/api/admin-tokens';
import {
	canApprove,
	isStepUpRefusal,
	loginRedirect,
	normalizeUserCode,
	outcomeForRefusal,
	type DeviceOutcome,
} from '$lib/device-login';
import type { Actions, PageServerLoad } from './$types';

/** What the page is showing: the code field, a request to decide, or an outcome. */
type View = 'enter' | 'pending' | DeviceOutcome;

/*
 * This page sits outside the console frame, like the sign-in page, so the
 * frame's guard does not run for it: it checks the session itself, and sends
 * a signed-out visitor to sign in and back here with the code intact.
 */
export const load: PageServerLoad = async (event) => {
	const { cookies, url } = event;
	if (!sessionToken(event)) {
		redirect(302, loginRedirect(url.pathname, url.search));
	}
	const client = authedClient(event);
	const user = await getMe(client).catch(() => null);
	if (!user) {
		clearSessionCookie(event);
		redirect(302, loginRedirect(url.pathname, url.search));
	}

	const raw = url.searchParams.get('code') ?? '';
	const page = (view: View, code: string, request: DeviceLoginRequest | null = null, mfaEnrolled = false) => ({
		email: user.email,
		view,
		code,
		request,
		mfaEnrolled,
	});

	if (!canApprove(user.roles)) return page('forbidden', raw);
	if (!raw) return page('enter', '');
	const code = normalizeUserCode(raw);
	if (!code) return page('unknown', raw);
	try {
		// Which confirmation the engine will ask for. An unreadable status asks
		// for the password, and an engine that wants a code says so.
		const [request, mfaEnrolled] = await Promise.all([
			getDeviceLogin(client, code),
			client
				.get<{ enabled: boolean }>('/api/admin/mfa/status')
				.then((s) => s.enabled === true)
				.catch(() => false),
		]);
		return page('pending', code, request, mfaEnrolled);
	} catch (e) {
		if (e instanceof ApiError) return page(outcomeForRefusal(e.status, e.message), code);
		return page('error', code);
	}
};

/** The confirmation the approve form carries, or the field to fill in. */
function stepUpOf(form: FormData): { step: 'password' | 'mfa_code'; stepUp?: DeviceStepUp; missing?: string } {
	if (form.get('step') === 'mfa_code') {
		const code = String(form.get('mfa_code') ?? '').trim();
		return code
			? { step: 'mfa_code', stepUp: { mfa_code: code } }
			: { step: 'mfa_code', missing: 'Enter the current code from your authenticator app.' };
	}
	const password = String(form.get('password') ?? '');
	return password
		? { step: 'password', stepUp: { password } }
		: { step: 'password', missing: 'Enter your current password.' };
}

/** Approves or denies the code the form carries, and reports the outcome. */
async function decide(event: Parameters<Actions[string]>[0], approve: boolean) {
	const form = await event.request.formData();
	const code = normalizeUserCode(String(form.get('code') ?? ''));
	if (!code) return fail(404, { outcome: 'unknown' as DeviceOutcome });
	const step = stepUpOf(form);
	if (approve && !step.stepUp) {
		return fail(400, { stepUp: { error: step.missing ?? '', field: step.missing ?? '', needsMfa: step.step === 'mfa_code' } });
	}
	const client = authedClient(event);
	try {
		if (approve && step.stepUp) {
			await approveDeviceLogin(client, code, step.stepUp);
		} else {
			await denyDeviceLogin(client, code);
		}
	} catch (e) {
		if (e instanceof ApiError) {
			// A wrong or missing confirmation leaves the request open: say so on
			// the field and keep the card on screen.
			if (approve && isStepUpRefusal(e.status, e.message)) {
				const r = describeRefusal(e.status, e.message, step.step);
				const field = r.fields.password ?? r.fields.mfa_code ?? '';
				return fail(e.status === 429 ? 429 : 400, {
					stepUp: { error: field ? '' : r.error, field, needsMfa: !!r.needsMfa || step.step === 'mfa_code' },
				});
			}
			return fail(e.status, { outcome: outcomeForRefusal(e.status, e.message) });
		}
		return fail(503, { outcome: 'error' as DeviceOutcome });
	}
	return { outcome: (approve ? 'approved' : 'denied') as DeviceOutcome };
}

export const actions: Actions = {
	approve: (event) => decide(event, true),
	deny: (event) => decide(event, false),
};
