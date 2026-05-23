import type { PageServerLoad, Actions } from './$types';
import { createClient } from '@lyeve-labs/client';
import type { Permission, Schema } from '@lyeve-labs/client';
import { getSchemas, listPermissions, upsertPermission, deletePermission } from '@lyeve-labs/client-rest';
import { refusalOf } from '$lib/api/refusal';
import { fail, error } from '@sveltejs/kit';
import { authedClient, requireRole } from '$lib/server/authz';
import { listAllFlows } from '$lib/api/flows';
import type { FlowOption } from '$lib/flow/types';
import { isFlowResource } from '$lib/flow/permissions';
import { getRoleLimits, type RoleLimits } from '$lib/api/permissions';
import { sessionToken } from '$lib/server/session-cookie';

// Static text. The engine's own message can carry driver or upstream detail
// that has no place in a page, and the operator's next step is the same
// whatever the cause.
const LOAD_FAILED = 'Permission rules could not be read from the engine. This is not a report that the instance has no rules.';

export const load: PageServerLoad = async ({ fetch, cookies, parent, url }) => {
	const { user } = await parent();
	if (!user.roles.includes('super_admin')) {
		error(403, 'Requires super_admin role');
	}
	const token = sessionToken({ cookies, url }) ?? '';
	const client = createClient(fetch, { Authorization: `Bearer ${token}` });
	// The plugin states the role ceiling and how many roles already hold a
	// rule, the numbers it checks a new role against. A failed read, a plugin
	// without the route among them, states no ceiling: the plugin still
	// refuses a role past one, and the page reports that refusal.
	const limits = await getRoleLimits(client).catch((): RoleLimits | null => null);
	const roleCap = limits?.roles.limit ?? 0;
	const roleCount = limits?.roles.current ?? null;
	try {
		// The flows are resources beside the schemas. An instance without the
		// flow plugin answers 404 for the list, which is an empty picker, not
		// a failed read of the rules.
		const [permissions, schemas, flows] = await Promise.all([listPermissions(client), getSchemas(client), listAllFlows(client).catch((): FlowOption[] => [])]);
		return { permissions, schemas, flows, roleCap, roleCount, loadError: null as string | null };
	} catch {
		// An empty list alone draws exactly the matrix an instance with no rules
		// draws. On a 503 or an expired session that would tell the operator
		// nothing is restricted, and the next click would grant a rule on top of
		// rules still in the database, so the failure is named.
		return { permissions: [] as Permission[], schemas: [] as Schema[], flows: [] as FlowOption[], roleCap, roleCount, loadError: LOAD_FAILED };
	}
};

// The plugin refuses a role past the ceiling with 402 and a body naming the
// cap and both numbers. The page writes the sentence from the numbers its own
// load read from the plugin, which are the ones the refusal checked.
function isRoleCapRefusal(e: unknown): boolean {
	return (e as { status?: number } | null)?.status === 402 && e instanceof Error && e.message === 'cap_exceeded';
}

export const actions: Actions = {
	upsert: async (event) => {
		await requireRole(event, ['super_admin']);
		const { request } = event;
		const form = await request.formData();
		const client = authedClient(event);

		const fieldMaskRaw = (form.get('field_mask') as string) ?? '';
		const actions = form.getAll('actions').map(String).filter(Boolean);
		// The role arrives typed by hand from the add-role form. Untrimmed,
		// "editor " becomes a second role the matrix lists next to "editor" and
		// nothing ever matches it.
		const role = ((form.get('role') as string) ?? '').trim();
		const schemaName = ((form.get('schema_name') as string) ?? '').trim();
		if (!role || !schemaName) {
			return fail(422, { error: 'Role and resource are required' });
		}
		// The engine's validator refuses activate on anything but a flow
		// resource. Refusing it here keeps the message about the form.
		if (actions.includes('activate') && !isFlowResource(schemaName)) {
			return fail(422, { error: 'Activate applies to flows only' });
		}

		try {
			await upsertPermission(
				{
					role,
					schema_name: schemaName,
					actions,
					field_mask: fieldMaskRaw ? fieldMaskRaw.split(',').map((s) => s.trim()).filter(Boolean) : [],
				},
				client,
			);
		} catch (e: unknown) {
			if (isRoleCapRefusal(e)) {
				const refused = refusalOf(e);
				return fail(402, { roleCapReached: true, refused });
			}
			return fail(400, { error: e instanceof Error ? e.message : 'Save failed' });
		}
		return { success: true };
	},

	delete: async (event) => {
		await requireRole(event, ['super_admin']);
		const { request } = event;
		const form = await request.formData();
		const client = authedClient(event);
		const id = form.get('id') as string;
		try {
			await deletePermission(id, client);
		} catch (e: unknown) {
			return fail(400, { error: e instanceof Error ? e.message : 'Delete failed' });
		}
		return { success: true };
	},
};
