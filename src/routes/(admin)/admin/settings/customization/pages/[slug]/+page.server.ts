import type { PageServerLoad, Actions } from './$types';
import { error, fail, redirect } from '@sveltejs/kit';
import { authedClient, requireRole } from '$lib/server/authz';
import { actionError } from '$lib/server/action-error';
import { listSchemaNames } from '$lib/api/search-settings';
import { readError } from '$lib/server/read-error';
import { GATE_OK, section } from '$lib/api/gate';
import {
	deleteCustomPage,
	getCustomPage,
	saveCustomPage,
	type CustomPage,
} from '$lib/api/customization';

export const load: PageServerLoad = async (event) => {
	const { user, customization } = await event.parent();
	if (!user.roles.some((r) => r === 'admin' || r === 'super_admin')) error(403, 'Requires the admin role');
	// The plugin says whether this tenant may shape its admin, and the shell
	// has read its answer. The customization page says why when it may not.
	if (!customization.entitled) redirect(303, '/admin/settings/customization');
	const client = authedClient(event);
	const [page, schemas] = await Promise.all([
		// Only the engine's 404 says the page does not exist. A refusal or an
		// outage keeps a status of its own.
		getCustomPage(client, event.params.slug).catch((err: unknown) =>
			readError(err, 'No page has that address.'),
		),
		// The gate says why the list is missing, so a role refusal and an
		// outage are not one failure.
		section(
			Promise.resolve().then(() => listSchemaNames(client)),
			'The schemas could not be read, so no schema can be picked below. A block keeps the schemas it already names.',
		),
	]);
	return { customPage: page, schemas: schemas.ok ? schemas.value : [], schemasGate: schemas.ok ? GATE_OK : schemas.gate };
};

export const actions: Actions = {
	save: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		const raw = String((await event.request.formData()).get('page') ?? '');
		let page: CustomPage;
		try {
			page = JSON.parse(raw) as CustomPage;
		} catch {
			return fail(400, { error: 'The page could not be read from the form.' });
		}
		page.slug = event.params.slug;
		try {
			// The engine validates every block and answers with the first
			// problem it finds, which is what the editor shows.
			await saveCustomPage(authedClient(event), page);
			return { saved: true };
		} catch (err) {
			return fail(400, { error: actionError(err, 'The page could not be saved.') });
		}
	},

	delete: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		try {
			await deleteCustomPage(authedClient(event), event.params.slug);
		} catch (err) {
			return fail(400, { error: actionError(err, 'The page could not be deleted.') });
		}
		redirect(303, '/admin/settings/customization');
	},
};
