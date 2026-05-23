import type { PageServerLoad, Actions } from './$types';
import { fail, error } from '@sveltejs/kit';
import { createClient } from '@lyeve-labs/client';
import { authedClient, requireRole } from '$lib/server/authz';
import {
	listTenants,
	createTenant,
	updateTenant,
	deleteTenant,
	type Tenant
} from '@lyeve-labs/client-rest';
import { actionError } from '$lib/server/action-error';
import { getProvisioning } from '$lib/api/tenants';
import { sessionToken } from '$lib/server/session-cookie';

export type { Tenant };

/** The engine's own page size when a request names none. */
const DEFAULT_LIMIT = 50;

/**
 * The engine's ceiling on a page. It clamps a larger request rather than
 * refusing it, so asking for more comes back silently short.
 */
const MAX_LIMIT = 500;

export const load: PageServerLoad = async ({ fetch, cookies, url, parent }) => {
	const { user } = await parent();
	if (!user.roles.includes('super_admin')) error(403, 'Requires super_admin role');
	const token = sessionToken({ cookies, url }) ?? '';
	const client = createClient(fetch, { Authorization: `Bearer ${token}` });

	const limit = Math.max(
		1,
		Math.min(MAX_LIMIT, Number(url.searchParams.get('limit')) || DEFAULT_LIMIT)
	);
	const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);

	// The plugin says whether a create would pass, so the page offers one only
	// then. A failed read, a plugin without the route among them, offers
	// none and says creating is not enabled, the way a refusal would.
	const [result, canProvision] = await Promise.all([
		listTenants(client, limit, offset).catch((): { items: Tenant[]; total: number } => ({ items: [], total: 0 })),
		getProvisioning(client).catch(() => false),
	]);

	// The envelope carries the collection count, so one server page is never
	// described as the whole instance. What has been read is the floor, for an
	// answer that omits the count.
	const total = Math.max(result.total, offset + result.items.length);

	return { tenants: result.items, limit, offset, total, canProvision };
};

export const actions: Actions = {
	create: async (event) => {
		await requireRole(event, ['super_admin']);
		const { request } = event;
		const client = authedClient(event);
		const data = await request.formData();
		const slug = String(data.get('slug') ?? '').trim();
		const name = String(data.get('name') ?? '').trim();
		const plan = String(data.get('plan') ?? '').trim();
		/*
		 * Per field, not one sentence for the form. A single banner naming both
		 * rules leaves the operator to work out which of the two controls it is
		 * about, so each control carries its own message.
		 */
		const fields: Record<string, string> = {};
		if (!slug) fields.slug = 'Slug is required';
		if (!name) fields.name = 'Display name is required';
		if (Object.keys(fields).length > 0) {
			return fail(400, { error: 'Check the highlighted fields.', fields });
		}
		try {
			await createTenant({ slug, name, plan: plan || undefined }, client);
		} catch (err) {
			return fail(400, { error: actionError(err, 'Failed to create tenant') });
		}
	},

	update: async (event) => {
		await requireRole(event, ['super_admin']);
		const { request } = event;
		const client = authedClient(event);
		const data = await request.formData();
		const id = String(data.get('id') ?? '');
		const name = String(data.get('name') ?? '').trim();
		const plan = String(data.get('plan') ?? '').trim();
		if (!name) return fail(400, { error: 'Check the highlighted fields.', fields: { name: 'Display name is required' } });
		try {
			await updateTenant(id, { name, plan: plan || undefined }, client);
		} catch (err) {
			return fail(400, { error: actionError(err, 'Failed to update tenant') });
		}
	},

	toggle: async (event) => {
		await requireRole(event, ['super_admin']);
		const { request } = event;
		const client = authedClient(event);
		const data = await request.formData();
		const id = String(data.get('id') ?? '');
		const enabled = data.get('enabled') === 'true';
		try {
			await updateTenant(id, { enabled: !enabled }, client);
		} catch (err) {
			return fail(400, { error: actionError(err, 'Failed to toggle tenant') });
		}
	},

	delete: async (event) => {
		await requireRole(event, ['super_admin']);
		const { request } = event;
		const client = authedClient(event);
		const data = await request.formData();
		const id = String(data.get('id') ?? '');
		try {
			await deleteTenant(id, client);
		} catch (err) {
			return fail(400, { error: actionError(err, 'Failed to delete tenant') });
		}
	},
};
