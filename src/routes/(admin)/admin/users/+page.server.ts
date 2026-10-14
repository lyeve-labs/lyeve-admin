import type { PageServerLoad, Actions } from './$types';
import { ApiError, type User } from '@lyeve-labs/client';
import { createUser, updateUserRoles, deleteUser, listTenants, type Tenant } from '@lyeve-labs/client-rest';
import { fail, error, redirect } from '@sveltejs/kit';
import { authedClient, requireRole } from '$lib/server/authz';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning } from '$lib/plugins';
import { actionError } from '$lib/server/action-error';
import { passwordBytes, passwordTooLong, setUserPassword } from '$lib/api/users';
import { seatRefusal } from '$lib/api/admin-seats';
import { section, type Section } from '$lib/api/gate';
import { pageWindow, pastEndOffset, withOffset } from '$lib/api/list';

/** The engine's own page size when a request names none. */
const DEFAULT_LIMIT = 25;

/**
 * One below the engine's ceiling of 200, because the request below asks for a
 * row past the page to learn whether another page exists. At the ceiling that
 * extra row would be clamped away and the last page would always look like the
 * last page.
 */
const MAX_LIMIT = 199;

export const load: PageServerLoad = async (event) => {
	const { url, parent } = event;
	const { user, plugins } = await parent();
	if (!user.roles.includes('super_admin')) {
		error(403, 'Requires super_admin role');
	}

	const client = authedClient(event);

	// Snapped to a page boundary, so the pager numbers the rows on screen.
	const { limit, offset } = pageWindow(url, DEFAULT_LIMIT, MAX_LIMIT);

	/*
	 * The users endpoint answers with a bare array and no row count, so there is
	 * no collection total to state and no numbered pager that could be built
	 * without inventing one. Asking for a single row past the page is the only
	 * honest thing available: it says whether a next page exists and nothing
	 * more. Without it, a page that ends at the engine's default looks complete.
	 */
	const [rows, tenants] = await Promise.all([
		section(
			client.get<User[]>(`/api/admin/users?limit=${limit + 1}&offset=${offset}`),
			'The accounts could not be read. This is not a report that there are none.'
		),
		// An account belongs to one tenant. With several, the engine cannot
		// tell which one a new account is for unless the form names it.
		notRunning(plugins, PLUGIN.multitenant)
			? Promise.resolve<Section<Tenant[]>>({ ok: true, value: [] })
			: section(
					listTenants(client, 500, 0).then((r) => (Array.isArray(r?.items) ? r.items : [])),
					'The tenants could not be read, so this form cannot name the tenant a new account belongs to.'
				),
	]);
	const page = rows.ok && Array.isArray(rows.value) ? rows.value : [];
	const hasMore = page.length > limit;
	if (rows.ok) {
		const back = pastEndOffset(page.length, limit, offset, null);
		if (back !== null) redirect(307, withOffset(url, back));
	}

	const users: Section<User[]> = rows.ok ? { ok: true, value: page.slice(0, limit) } : rows;
	const choices: Section<{ slug: string; name: string }[]> = tenants.ok
		? { ok: true, value: tenants.value.filter((t) => !t.archived).map((t) => ({ slug: t.slug, name: t.name })) }
		: tenants;
	return { users, limit, offset, hasMore, tenants: choices };
};

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
		// The engine's own default minimum, counted in bytes as the engine counts
		// it. The engine judges every other rule, and its refusal lands on this
		// field below. Past the hasher's limit it fails without naming a rule.
		if (!password) fields.password = 'Password is required';
		else if (passwordBytes(password) < 12) fields.password = 'Password must be at least 12 characters';
		else if (passwordTooLong(password)) fields.password = passwordTooLong(password) ?? '';
		// The form offers the choice only where there is one to make, and then
		// it is required: the engine refuses an account that names no tenant.
		const tenant = String(form.get('tenant_id') ?? '').trim();
		if (form.get('tenant_required') === '1' && !tenant) fields.tenant_id = 'Choose the tenant this account belongs to';
		if (Object.keys(fields).length > 0) {
			return fail(400, { action: 'create', error: 'Check the highlighted fields.', fields });
		}
		// The engine honors X-Tenant-ID from a super admin only, and checks the
		// slug against its roster.
		const target = tenant ? authedClient(event, { 'X-Tenant-ID': tenant }) : client;
		try {
			await createUser(email, password, roles.length ? roles : ['editor'], target);
			return { ok: true };
		} catch (err) {
			const full = seatRefusal(err);
			if (full) return fail(402, { action: 'create', error: full });
			// The email is checked above, so a 422 is the password policy.
			if (err instanceof ApiError && err.status === 422) {
				return fail(422, {
					action: 'create',
					error: 'Check the highlighted field.',
					fields: { password: actionError(err, 'The password does not meet the policy') },
				});
			}
			return fail(400, { action: 'create', error: actionError(err, 'Failed to create user') });
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
			if (full) return fail(402, { action: 'updateRoles', error: full });
			return fail(400, { action: 'updateRoles', error: actionError(err, 'Failed to update roles') });
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
			return fail(400, { action: 'delete', error: actionError(err, 'Failed to delete user') });
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
		const problem = password ? passwordTooLong(password) : 'Password is required';
		if (problem) {
			return fail(400, {
				action: 'setPassword',
				error: 'Check the highlighted field.',
				fields: { new_password: problem },
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
					action: 'setPassword',
					error: 'Check the highlighted field.',
					fields: { new_password: actionError(err, 'The password does not meet the policy') },
				});
			}
			return fail(400, { action: 'setPassword', error: actionError(err, 'Failed to set password') });
		}
	},
};
