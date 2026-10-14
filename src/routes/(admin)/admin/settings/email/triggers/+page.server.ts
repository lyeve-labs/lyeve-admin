import type { Actions, PageServerLoad } from './$types';
import { fail } from '@sveltejs/kit';
import { ApiError } from '@lyeve-labs/client';
import { isOutage, section } from '$lib/api/gate';
import { getSchemas } from '@lyeve-labs/client-rest';
import { authedClient, requireRole } from '$lib/server/authz';
import { actionError, actionFailure } from '$lib/server/action-error';
import { refusalOf } from '$lib/api/refusal';
import {
	createEmailTrigger,
	deleteEmailTrigger,
	listEmailTemplates,
	listEmailTriggers,
	updateEmailTrigger,
} from '$lib/api/email-triggers';
import { readTriggerForm } from '$lib/server/email-trigger-form';

export const load: PageServerLoad = async (event) => {
	const client = authedClient(event);
	// Each read keeps its own failure. A template list that did not answer is
	// not a tenant without templates, and a schema list that did not answer is
	// not an instance without schemas.
	const [triggers, templates, schemas] = await Promise.all([
		section(listEmailTriggers(client), 'The triggers could not be read. This is not a report that there are none.'),
		section(listEmailTemplates(client), 'The templates could not be read, so a trigger cannot be given one right now.'),
		section(
			getSchemas(client).then((rows: { name: string }[]) => rows.map((s) => s.name).sort()),
			'The schemas could not be read, so a trigger can only watch every schema right now.',
		),
	]);
	return { triggers, templates, schemas };
};

/**
 * The failure of a trigger write, named for the action that caused it. A 402
 * keeps its refusal so the page can say what the license lacks, an outage
 * keeps its own status, and a field the plugin rejected keeps its 422.
 */
function writeFailure(action: 'save' | 'delete', err: unknown, fallback: string) {
	if (refusalOf(err)) {
		const refused = actionFailure(err, fallback);
		return fail(refused.status, { ...refused.data, action });
	}
	const status = isOutage(err) ? 503 : err instanceof ApiError && err.status === 422 ? 422 : 400;
	return fail(status, { action, error: actionError(err, fallback) });
}

export const actions: Actions = {
	save: async (event) => {
		// The plugin serves trigger writes to admins and super admins.
		await requireRole(event, ['admin', 'super_admin']);
		const client = authedClient(event);
		const data = await event.request.formData();
		const read = readTriggerForm(data);
		if ('error' in read) return fail(400, { action: 'save', error: read.error });
		const id = String(data.get('id') ?? '').trim();
		try {
			if (id) await updateEmailTrigger(client, id, read.input);
			else await createEmailTrigger(client, read.input);
			return { saved: true };
		} catch (err) {
			return writeFailure('save', err, 'The trigger could not be saved.');
		}
	},

	delete: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		const client = authedClient(event);
		const id = String((await event.request.formData()).get('id') ?? '').trim();
		if (!id) return fail(400, { action: 'delete', error: 'Choose a trigger.' });
		try {
			await deleteEmailTrigger(client, id);
			return { deleted: id };
		} catch (err) {
			return writeFailure('delete', err, 'The trigger could not be deleted.');
		}
	},
};
