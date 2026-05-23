import type { PageServerLoad, Actions } from './$types';
import { fail } from '@sveltejs/kit';
import { authedClient, requireRole } from '$lib/server/authz';
import { actionFailure } from '$lib/server/action-error';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning } from '$lib/plugins';
import { GATE_OK, type Gate } from '$lib/api/gate';
import {
	captchaSettingsGate,
	clearCaptchaSettings,
	isCaptchaProvider,
	readCaptchaSettings,
	saveCaptchaSettings,
	type CaptchaSettings,
} from '$lib/api/captcha-settings';

export const load: PageServerLoad = async (event) => {
	const { plugins } = await event.parent();
	if (notRunning(plugins, PLUGIN.captcha)) {
		return { gate: { state: 'absent' } as Gate, settings: null as CaptchaSettings | null };
	}
	try {
		return { gate: GATE_OK as Gate, settings: await readCaptchaSettings(authedClient(event)) };
	} catch (err) {
		return { gate: captchaSettingsGate(err), settings: null as CaptchaSettings | null };
	}
};

export const actions: Actions = {
	save: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		const form = await event.request.formData();
		const provider = String(form.get('provider') ?? '');
		const siteKey = String(form.get('site_key') ?? '').trim();
		const secret = String(form.get('secret_key') ?? '').trim();
		const floorRaw = String(form.get('score_floor') ?? '').trim();

		if (!isCaptchaProvider(provider)) return fail(400, { error: 'Choose Turnstile, hCaptcha or reCAPTCHA.' });
		if (!siteKey || siteKey.length > 255) {
			return fail(400, { error: 'The site key is required and at most 255 characters.' });
		}
		if (secret.length > 4096) return fail(400, { error: 'The secret key is at most 4096 characters.' });

		// The score floor is reCAPTCHA's alone. Sent for another provider the
		// plugin refuses the save, so it is dropped rather than carried over.
		let scoreFloor: number | null = null;
		if (provider === 'recaptcha' && floorRaw !== '') {
			const n = Number(floorRaw);
			if (!Number.isFinite(n) || n < 0 || n > 1) {
				return fail(400, { error: 'The score floor is a number from 0 to 1.' });
			}
			scoreFloor = n;
		}

		try {
			await saveCaptchaSettings(authedClient(event), {
				provider,
				site_key: siteKey,
				secret_key: secret,
				score_floor: scoreFloor,
			});
		} catch (err) {
			return actionFailure(err, 'The captcha settings could not be saved.');
		}
		return { saved: true };
	},

	// Clearing puts the tenant's flows back on the install's settings, and is
	// always allowed.
	clear: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		try {
			await clearCaptchaSettings(authedClient(event));
		} catch (err) {
			return actionFailure(err, 'The captcha settings could not be cleared.');
		}
		return { cleared: true };
	},
};
