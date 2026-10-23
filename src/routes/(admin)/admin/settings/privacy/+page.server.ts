import type { Actions, PageServerLoad } from './$types';
import { error, fail } from '@sveltejs/kit';
import { authedClient, requireRole } from '$lib/server/authz';
import { actionFailure } from '$lib/server/action-error';
import { forbiddenText, isOutage } from '$lib/api/gate';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning, whyNotRunning } from '$lib/plugins';
import {
	isFormErasureMode,
	namesNoTenant,
	readFormErasure,
	saveFormErasure,
	setting,
	type FormErasure,
	type Setting,
} from '$lib/api/privacy';

/** The roles the engine lets read and change a tenant's privacy settings. */
const EDITORS = ['admin', 'super_admin'];

export const load: PageServerLoad = async (event) => {
	const { plugins, pluginStatus, user } = await event.parent();
	if (!user.roles.some((r) => EDITORS.includes(r))) error(403, forbiddenText('the privacy settings'));
	const client = authedClient(event);
	// A setting whose plugin the engine says is stopped is not read, and its
	// card says why, the way the shell does for a stopped plugin's page. A
	// plugin that runs and answers 404 predates the setting, so the card is
	// left out: the running list is what tells the two apart.
	const erasureRead = notRunning(plugins, PLUGIN.schema)
		? { ok: false as const, stopped: whyNotRunning(PLUGIN.schema, plugins, pluginStatus) }
		: await setting(
				readFormErasure(client),
				'What an erasure does with form submissions could not be read. This is not a report that it uses the default.',
			);
	// Every setting here is a tenant's. A session that names none is told so
	// once, and no card is drawn.
	if (namesNoTenant(erasureRead)) return { noTenant: true, formErasure: null };
	const formErasure: Setting<FormErasure> = erasureRead;
	return { noTenant: false, formErasure };
};

/** A failed save, tagged with its form. An outage answers 503, never a client error. */
function saveFailed(action: 'erasure', err: unknown, fallback: string) {
	const failed = actionFailure(err, fallback, isOutage(err) ? 503 : 400);
	return fail(failed.status, { action, ...failed.data });
}

export const actions: Actions = {
	erasure: async (event) => {
		await requireRole(event, EDITORS);
		const mode = String((await event.request.formData()).get('mode') ?? '');
		if (!isFormErasureMode(mode)) {
			return fail(400, { action: 'erasure' as const, error: 'Choose what an erasure does with form submissions.' });
		}
		try {
			await saveFormErasure(authedClient(event), mode);
			return { action: 'erasure' as const, saved: true };
		} catch (err) {
			return saveFailed('erasure', err, 'The choice could not be saved. Erasures keep following the one saved before.');
		}
	},
};
