import type { PageServerLoad, Actions } from './$types';
import { exportSubject, eraseSubject } from '@lyeve-labs/client-rest';
import { fail, error } from '@sveltejs/kit';
import { authedClient, requireRole } from '$lib/server/authz';

export const load: PageServerLoad = async ({ parent }) => {
	const { user } = await parent();
	if (!user.roles.includes('super_admin')) {
		error(403, 'Requires super_admin role');
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
		} catch (e: unknown) {
			const msg = e instanceof Error ? e.message : 'Export failed';
			return fail(400, { action: 'export', error: msg });
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
		} catch (e: unknown) {
			const msg = e instanceof Error ? e.message : 'Erasure failed';
			return fail(400, { action: 'erase', error: msg });
		}
	},
};
