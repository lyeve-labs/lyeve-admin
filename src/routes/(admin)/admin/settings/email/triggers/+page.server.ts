import type { Actions, PageServerLoad } from './$types';
import { fail } from '@sveltejs/kit';
import { ApiError } from '@lyeve-labs/client';
import { section } from '$lib/api/gate';
import { getSchemas } from '@lyeve-labs/client-rest';
import { authedClient, requireUser } from '$lib/server/authz';
import { actionError, actionFailure } from '$lib/server/action-error';
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

export const actions: Actions = {
	save: async (event) => {
		await requireUser(event);
		const client = authedClient(event);
		const data = await event.request.formData();
		const read = readTriggerForm(data);
		if ('error' in read) return fail(400, { error: read.error });
		const id = String(data.get('id') ?? '').trim();
		try {
			if (id) await updateEmailTrigger(client, id, read.input);
			else await createEmailTrigger(client, read.input);
			return { saved: true };
		} catch (err) {
			return fail(err instanceof ApiError && err.status === 422 ? 422 : 400, {
				error: actionError(err, 'The trigger could not be saved.'),
			});
		}
	},

	delete: async (event) => {
		await requireUser(event);
		const client = authedClient(event);
		const id = String((await event.request.formData()).get('id') ?? '').trim();
		if (!id) return fail(400, { error: 'Choose a trigger.' });
		try {
			await deleteEmailTrigger(client, id);
			return { deleted: id };
		} catch (err) {
			return actionFailure(err, 'The trigger could not be deleted.');
		}
	},
};
