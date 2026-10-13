import type { PageServerLoad, Actions } from './$types';
import { exportSubject, eraseSubject } from '@lyeve-labs/client-rest';
import { fail, error } from '@sveltejs/kit';
import { authedClient, requireRole } from '$lib/server/authz';
import { actionError } from '$lib/server/action-error';
import { forbiddenText } from '$lib/api/gate';

export const load: PageServerLoad = async ({ parent }) => {
	const { user } = await parent();
	if (!user.roles.includes('super_admin')) {
		error(403, forbiddenText('privacy requests'));
	}
	return {};
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
