import type { PageServerLoad, Actions } from './$types';
import { fail, error, redirect } from '@sveltejs/kit';
import { authedClient, requireRole } from '$lib/server/authz';
import {
	listTenants,
	createTenant,
	updateTenant,
	deleteTenant,
	type Tenant
} from '@lyeve-labs/client-rest';
import { ApiError } from '@lyeve-labs/client';
import { actionError, actionFailure } from '$lib/server/action-error';
import { getProvisioning } from '$lib/api/tenants';
import { section, type Gate, type Section } from '$lib/api/gate';
import { pageWindow, pastEndOffset, withOffset } from '$lib/api/list';

export type { Tenant };

/** The engine's own page size when a request names none. */
const DEFAULT_LIMIT = 50;

/**
 * The engine's ceiling on a page. It clamps a larger request rather than
 * refusing it, so asking for more comes back silently short.
 */
const MAX_LIMIT = 500;

/** What the page says for a list read that failed for no reason it can name. */
const LIST_FAILED = 'The tenants could not be read. This is not a report that there are none.';

/** What the page says when it cannot tell whether a tenant may be created. */
const PROVISIONING_FAILED = 'Whether this instance may create tenants could not be read.';

/** The plan the plugin stores for a tenant created with none. */
const DEFAULT_PLAN = 'free';

/**
 * The failure of a create the plugin refused. A slug the engine does not
 * accept lands on the Slug field. A 402 that names a capability is the
 * license refusal, and any other 402 carries its own sentence, such as the
 * tenant quota, which the refusal notice would misname.
 */
function createFailure(err: unknown) {
	if (err instanceof ApiError && err.status === 400 && err.message?.startsWith('invalid slug')) {
		return fail(400, { action: 'create', error: 'Check the highlighted fields.', fields: { slug: err.message } });
	}
	const body = err instanceof ApiError ? ((err.body ?? {}) as { error?: unknown }) : {};
	if (err instanceof ApiError && err.status === 402 && (body.error === 'payment_required' || body.error === 'cap_exceeded')) {
		const refused = actionFailure(err, 'Failed to create tenant');
		return fail(402, { ...refused.data, action: 'create' });
	}
	return fail(400, { action: 'create', error: actionError(err, 'Failed to create tenant') });
}

export const load: PageServerLoad = async (event) => {
	const { url, parent } = event;
	const { user } = await parent();
	if (!user.roles.includes('super_admin')) error(403, 'Requires super_admin role');
	const client = authedClient(event);

	const { limit, offset } = pageWindow(url, DEFAULT_LIMIT, MAX_LIMIT);

	// The plugin says whether a create would pass, so the page offers one only
	// then. A refusal, or a plugin without the route, says creating is not
	// enabled. Any other failure is unread: the page offers no create and says
	// it could not tell, rather than calling the instance unlicensed.
	const [read, provisioning] = await Promise.all([
		section(listTenants(client, limit, offset), LIST_FAILED),
		section(getProvisioning(client), PROVISIONING_FAILED),
	]);
	const canProvision = provisioning.ok && provisioning.value;
	const provisionGate: Gate | null =
		!provisioning.ok && provisioning.gate.state !== 'absent' && provisioning.gate.state !== 'locked'
			? provisioning.gate
			: null;
	// The page draws the gate in place of the list and offers no create.
	if (!read.ok) return { tenants: read, limit, offset, total: 0, canProvision: false, provisionGate: null };
	const result = read.value;
	// A page past the end is not an instance with no tenants, so the request
	// goes back to the last page that holds rows.
	const back = pastEndOffset(result.items.length, limit, offset, result.total > 0 ? result.total : null);
	if (back !== null) redirect(307, withOffset(url, back));

	// The envelope carries the collection count, so one server page is never
	// described as the whole instance. What has been read is the floor, for an
	// answer that omits the count.
	const total = Math.max(result.total, offset + result.items.length);

	// Typed, because a bare literal widens `ok` to boolean and the page could
	// no longer tell the two cases apart.
	const tenants: Section<Tenant[]> = { ok: true, value: result.items };
	return { tenants, limit, offset, total, canProvision, provisionGate };
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
			return fail(400, { action: 'create', error: 'Check the highlighted fields.', fields });
		}
		try {
			await createTenant({ slug, name, plan: plan || undefined }, client);
		} catch (err) {
			return createFailure(err);
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
		if (!name) return fail(400, { action: 'update', error: 'Check the highlighted fields.', fields: { name: 'Display name is required' } });
		try {
			// The plugin keeps the stored plan when the key is absent, so an
			// emptied field sends the plan a create with none is given.
			await updateTenant(id, { name, plan: plan || DEFAULT_PLAN }, client);
		} catch (err) {
			return fail(400, { action: 'update', error: actionError(err, 'Failed to update tenant') });
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
			return fail(400, { action: 'toggle', error: actionError(err, 'Failed to toggle tenant') });
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
			return fail(400, { action: 'delete', error: actionError(err, 'Failed to delete tenant') });
		}
	},
};
