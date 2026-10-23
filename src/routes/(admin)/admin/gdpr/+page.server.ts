import type { PageServerLoad, Actions } from './$types';
import { exportSubject, eraseSubject } from '@lyeve-labs/client-rest';
import { fail, error } from '@sveltejs/kit';
import { ApiError } from '@lyeve-labs/client';
import { authedClient, loadUser, requireRole } from '$lib/server/authz';
import { actionError, actionFailure } from '$lib/server/action-error';
import { forbiddenText, isOutage } from '$lib/api/gate';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning, whyNotRunning } from '$lib/plugins';
import { installSetting, type Setting } from '$lib/api/privacy';
import { isStepUpFactor, mailUnavailable, readStepUp, saveStepUp, type StepUp } from '$lib/api/export-step-up';

export const load: PageServerLoad = async (event) => {
	const user = await loadUser(event);
	if (!user.roles.includes('super_admin')) {
		error(403, forbiddenText('privacy requests'));
	}
	const { plugins, pluginStatus } = await event.parent();
	// The step-up is served by the plugin that runs the self-service export.
	// While the engine says that plugin is stopped, the section says why. A
	// plugin that runs and answers 404 predates the setting, which is left out.
	const stepUp: Setting<StepUp> = notRunning(plugins, PLUGIN.productAnalytics)
		? { ok: false, stopped: whyNotRunning(PLUGIN.productAnalytics, plugins, pluginStatus) }
		: await installSetting(
				readStepUp(authedClient(event)),
				'What a person proves before exporting could not be read. This is not a report that nothing is asked.',
			);
	return { stepUp };
};

export const actions: Actions = {
	export: async (event) => {
		await requireRole(event, ['super_admin']);
		const client = authedClient(event);
		const form = await event.request.formData();
		const subject = String(form.get('subject') ?? '').trim();
		if (!subject) {
			return fail(400, { action: 'export', error: 'Subject identifier is required' });
		}
		try {
			const result = await exportSubject(subject, client);
			return { action: 'export', ok: true, subject, result };
		} catch (err) {
			return fail(400, { action: 'export', error: actionError(err, 'The export could not be made. Nothing was read for this subject.') });
		}
	},

	stepUp: async (event) => {
		await requireRole(event, ['super_admin']);
		const posted = (await event.request.formData()).getAll('factors').map(String);
		const factors = posted.filter(isStepUpFactor);
		if (factors.length !== posted.length) {
			return fail(400, { action: 'stepUp' as const, error: 'Choose among the password, an authenticator code and an emailed code.' });
		}
		try {
			await saveStepUp(authedClient(event), [...new Set(factors)]);
			return { action: 'stepUp' as const, ok: true };
		} catch (err) {
			if (mailUnavailable(err)) {
				return fail(422, {
					action: 'stepUp' as const,
					error: 'This install cannot send mail, so an emailed code cannot be required. Set up email first, or leave it unticked. Nothing was changed.',
				});
			}
			if (err instanceof ApiError && err.status === 400) {
				return fail(400, { action: 'stepUp' as const, error: 'One of the steps is not one this install knows. Nothing was changed.' });
			}
			// A license refusal answers 402 with its way forward, and an outage
			// answers 503, never a client error.
			const failed = actionFailure(
				err,
				'What a person proves before exporting could not be saved. Nothing was changed.',
				isOutage(err) ? 503 : 400,
			);
			return fail(failed.status, { action: 'stepUp' as const, ...failed.data });
		}
	},

	erase: async (event) => {
		await requireRole(event, ['super_admin']);
		const client = authedClient(event);
		const form = await event.request.formData();
		const subject = String(form.get('subject') ?? '').trim();
		const confirm = String(form.get('confirm') ?? '').trim();
		if (!subject) {
			return fail(400, { action: 'erase', error: 'Subject identifier is required' });
		}
		if (confirm !== subject) {
			return fail(400, {
				action: 'erase',
				error: 'Confirmation does not match the subject identifier',
			});
		}
		try {
			const result = await eraseSubject(subject, client);
			return { action: 'erase', ok: true, subject, result };
		} catch (err) {
			return fail(400, {
				action: 'erase',
				error: actionError(err, 'The erasure was not attempted, so nothing was erased. Try again in a moment.'),
			});
		}
	},
};
