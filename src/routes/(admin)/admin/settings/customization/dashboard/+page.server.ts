import type { PageServerLoad, Actions } from './$types';
import { error, fail, redirect } from '@sveltejs/kit';
import { authedClient, requireRole } from '$lib/server/authz';
import { actionError } from '$lib/server/action-error';
import { listSchemaNames } from '$lib/api/search-settings';
import { ROLE_CHOICES } from '$lib/api/customization';
import { readPluginSet } from '$lib/plugins';
import {
	MAX_WIDGETS,
	getDashboardLayout,
	resetDashboardLayout,
	saveDashboardLayout,
	wireWidget,
	type Widget,
} from '$lib/api/custom-dashboard';
import { resolveWidgets } from '$lib/server/dashboard-widgets';

export const load: PageServerLoad = async (event) => {
	const { user, customization } = await event.parent();
	if (!user.roles.some((r) => r === 'admin' || r === 'super_admin')) error(403, 'Requires the admin role');
	// The plugin says whether this tenant may shape its admin, and the shell
	// has read its answer. The customization page says why when it may not.
	if (!customization.entitled) redirect(303, '/admin/settings/customization');
	const client = authedClient(event);
	const [layout, schemas] = await Promise.all([
		getDashboardLayout(client).catch(() => null),
		Promise.resolve()
			.then(() => listSchemaNames(client))
			.catch((): string[] => []),
	]);
	if (!layout) error(503, 'The dashboard layout could not be read.');
	return { layout, schemas };
};

/** The widgets a form posted, or null when the field is not a widget list. */
function postedWidgets(form: FormData): Widget[] | null {
	try {
		const parsed = JSON.parse(String(form.get('widgets') ?? ''));
		return Array.isArray(parsed) ? (parsed as Widget[]) : null;
	} catch {
		return null;
	}
}

export const actions: Actions = {
	save: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		const widgets = postedWidgets(await event.request.formData());
		if (!widgets) return fail(400, { error: 'The layout could not be read from the form.' });
		if (widgets.length === 0) {
			return fail(400, { error: 'Add a widget first, or reset to go back to the stock dashboard.' });
		}
		if (widgets.length > MAX_WIDGETS) return fail(400, { error: `A dashboard holds at most ${MAX_WIDGETS} widgets.` });
		try {
			// The engine validates every widget and answers with the first
			// problem it finds, numbered, which is what the editor shows.
			await saveDashboardLayout(authedClient(event), widgets);
			return { saved: true };
		} catch (err) {
			return fail(400, { error: actionError(err, 'The dashboard could not be saved.') });
		}
	},

	/*
	 * Draws the layout in the form as the chosen role would see it, before it
	 * is saved. It writes nothing. It is an action because the layout being
	 * previewed exists only in the form.
	 */
	preview: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		const form = await event.request.formData();
		const widgets = postedWidgets(form);
		if (!widgets) return fail(400, { error: 'The layout could not be read from the form.' });
		const asRole = String(form.get('as') ?? 'admin');
		const roles = (ROLE_CHOICES as readonly string[]).includes(asRole) ? [asRole] : ['admin'];
		const client = authedClient(event);
		const preview = await resolveWidgets(client, widgets.map(wireWidget), roles, await readPluginSet(client));
		return { preview, previewAs: roles[0], previewAt: new Date().toISOString() };
	},

	reset: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		try {
			await resetDashboardLayout(authedClient(event));
			return { reset: true };
		} catch (err) {
			return fail(400, { error: actionError(err, 'The dashboard could not be reset.') });
		}
	},
};
