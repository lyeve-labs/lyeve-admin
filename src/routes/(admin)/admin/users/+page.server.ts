import type { PageServerLoad, Actions } from './$types';
import { ApiError, createClient, type User } from '@lyeve-labs/client';
import { createUser, updateUserRoles, deleteUser, listTenants, type Tenant } from '@lyeve-labs/client-rest';
import { fail, error } from '@sveltejs/kit';
import { authedClient, authedHeaders, requireRole } from '$lib/server/authz';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning } from '$lib/plugins';
import { actionError } from '$lib/server/action-error';
import { setUserPassword } from '$lib/api/users';
import { sessionToken } from '$lib/server/session-cookie';
import { seatRefusal } from '$lib/api/admin-seats';

/** The engine's own page size when a request names none. */
const DEFAULT_LIMIT = 25;

/**
 * One below the engine's ceiling of 200, because the request below asks for a
 * row past the page to learn whether another page exists. At the ceiling that
 * extra row would be clamped away and the last page would always look like the
 * last page.
 */
const MAX_LIMIT = 199;

export const load: PageServerLoad = async ({ fetch, cookies, url, parent }) => {
	const { user, plugins } = await parent();
	if (!user.roles.includes('super_admin')) {
		error(403, 'Requires super_admin role');
	}

	const token = sessionToken({ cookies, url }) ?? '';
	const client = createClient(fetch, { Authorization: `Bearer ${token}` });

	const limit = Math.max(
		1,
		Math.min(MAX_LIMIT, Number(url.searchParams.get('limit')) || DEFAULT_LIMIT)
	);
	const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);

	/*
	 * The users endpoint answers with a bare array and no row count, so there is
	 * no collection total to state and no numbered pager that could be built
	 * without inventing one. Asking for a single row past the page is the only
	 * honest thing available: it says whether a next page exists and nothing
	 * more. Without it, a page that ends at the engine's default looks complete.
	 */
	const [rows, tenants] = await Promise.all([
		client.get<User[]>(`/api/admin/users?limit=${limit + 1}&offset=${offset}`).catch(() => [] as User[]),
		// An account belongs to one tenant. With several, the engine cannot
		// tell which one a new account is for unless the form names it.
		notRunning(plugins, PLUGIN.multitenant)
			? Promise.resolve<Tenant[]>([])
			: listTenants(client, 500, 0)
					.then((r) => (Array.isArray(r?.items) ? r.items : []))
					.catch((): Tenant[] => []),
	]);
	const page = Array.isArray(rows) ? rows : [];
	const hasMore = page.length > limit;

	return {
		users: page.slice(0, limit),
		limit,
		offset,
		hasMore,
		tenants: tenants.filter((t) => !t.archived).map((t) => ({ slug: t.slug, name: t.name })),
	};
};

/**
 * A client whose requests act in tenant. The engine honors X-Tenant-ID from a
 * super admin only, and checks the slug against its roster.
 */
function inTenant(event: Parameters<Actions[string]>[0], tenant: string) {
	const headers = { ...authedHeaders(event), 'X-Tenant-ID': tenant };
	return createClient((url, init) => event.fetch(url, { ...init, headers: { ...init?.headers, ...headers } }));
}

export const actions: Actions = {
	create: async (event) => {
		await requireRole(event, ['super_admin']);
		const { request } = event;
		const client = authedClient(event);
		const form = await request.formData();
		const email = String(form.get('email') ?? '').trim();
		const password = String(form.get('password') ?? '');
		// The roles field arrives once per ticked checkbox. A single comma
		// separated value still parses, so a form posted without JavaScript and
		// the API's own callers keep working.
		const roles = form
			.getAll('roles')
			.flatMap((value) => String(value).split(','))
			.map((role) => role.trim())
			.filter(Boolean);

		/*
		 * Per field, not one sentence for the form. A single banner saying both
		 * rules leaves the operator to work out which of the two controls it is
		 * about, so each control carries its own message.
		 */
		const fields: Record<string, string> = {};
		if (!email) fields.email = 'Email is required';
		if (!password) fields.password = 'Password is required';
		else if (password.length < 8) fields.password = 'Password must be at least 8 characters';
		// The form offers the choice only where there is one to make, and then
		// it is required: the engine refuses an account that names no tenant.
		const tenant = String(form.get('tenant_id') ?? '').trim();
		if (form.get('tenant_required') === '1' && !tenant) fields.tenant_id = 'Choose the tenant this account belongs to';
		if (Object.keys(fields).length > 0) {
			return fail(400, { error: 'Check the highlighted fields.', fields });
		}
		try {
			await createUser(email, password, roles.length ? roles : ['editor'], tenant ? inTenant(event, tenant) : client);
			return { ok: true };
		} catch (err) {
			const full = seatRefusal(err);
			if (full) return fail(402, { error: full });
			return fail(400, { error: actionError(err, 'Failed to create user') });
		}
	},

	updateRoles: async (event) => {
		await requireRole(event, ['super_admin']);
		const { request } = event;
		const client = authedClient(event);
		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		// One value per ticked box from the drawer, or one comma separated
		// value from a caller without JavaScript. Both parse.
		const roles = form
			.getAll('roles')
			.flatMap((value) => String(value).split(','))
			.map((r) => r.trim())
			.filter(Boolean);
		try {
			await updateUserRoles(id, roles, client);
			return { ok: true };
		} catch (err) {
			const full = seatRefusal(err);
			if (full) return fail(402, { error: full });
			return fail(400, { error: actionError(err, 'Failed to update roles') });
		}
	},

	delete: async (event) => {
		await requireRole(event, ['super_admin']);
		const { request } = event;
		const client = authedClient(event);
		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		try {
			await deleteUser(id, client);
			return { ok: true };
		} catch (err) {
			return fail(400, { error: actionError(err, 'Failed to delete user') });
		}
	},

	setPassword: async (event) => {
		await requireRole(event, ['super_admin']);
		const { request } = event;
		const client = authedClient(event);
		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		const password = String(form.get('new_password') ?? '');
		// The field is named apart from the create form's so a refusal lands
		// on the control that was submitted and never on the other drawer's.
		if (!password) {
			return fail(400, {
				error: 'Check the highlighted field.',
				fields: { new_password: 'Password is required' },
			});
		}
		try {
			await setUserPassword(id, password, client);
			return { ok: true };
		} catch (err) {
			/*
			 * The policy lives in the engine, and its 422 names the rule that
			 * refused the password. That sentence belongs on the control, where
			 * the operator is about to type again, not in a banner above the
			 * page. Every other refusal (an unknown account, a bad body) is
			 * about the request rather than the password and goes to the banner.
			 */
			if (err instanceof ApiError && err.status === 422) {
				return fail(422, {
					error: 'Check the highlighted field.',
					fields: { new_password: actionError(err, 'The password does not meet the policy') },
				});
			}
			return fail(400, { error: actionError(err, 'Failed to set password') });
		}
	},
};
