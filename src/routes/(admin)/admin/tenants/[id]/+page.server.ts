import type { PageServerLoad, Actions } from './$types';
import { error, fail } from '@sveltejs/kit';
import { archiveTenant, getTenant, restoreTenant } from '@lyeve-labs/client-rest';
import { authedClient, requireRole } from '$lib/server/authz';
import { actionError } from '$lib/server/action-error';
import { seatRefusal } from '$lib/api/admin-seats';
import {
	featureChoices,
	findUserByEmail,
	getTenantFeatures,
	grantMembership,
	listTenantMembers,
	revokeMembership,
	setTenantFeatures,
	withheldFrom,
	type FeatureChoice,
	type TenantMember,
} from '$lib/api/tenant-access';

export const load: PageServerLoad = async (event) => {
	const { user, entitlements } = await event.parent();
	if (!user.roles.includes('super_admin')) error(403, 'Requires super_admin role');
	const client = authedClient(event);

	const tenant = await getTenant(event.params.id, client).catch(() => null);
	if (!tenant) error(404, 'No tenant has that id.');

	// Each half is read on its own: a members list that fails is no reason to
	// hide what the tenant may use, and the reverse.
	const [features, members] = await Promise.all([
		getTenantFeatures(client, tenant.slug).catch(() => null),
		listTenantMembers(client, tenant.slug, 200, 0).catch(() => null),
	]);

	// The entitlements the layout read are the signed-in super admin's, whose
	// tenant is not this one, so only `features` is read from them: the
	// license, which is the same for every tenant.
	const licensed = entitlements?.features ?? [];
	const choices: FeatureChoice[] | null = features
		? featureChoices(features.known, licensed, features.withheld)
		: null;

	return {
		tenant,
		choices,
		members: (members?.members ?? null) as TenantMember[] | null,
		memberTotal: members?.total ?? 0,
	};
};

async function tenantSlug(event: Parameters<Actions[string]>[0]): Promise<string> {
	const tenant = await getTenant(event.params.id ?? '', authedClient(event));
	return tenant.slug;
}

export const actions: Actions = {
	features: async (event) => {
		await requireRole(event, ['super_admin']);
		const form = await event.request.formData();
		const offered = form.getAll('offered').map(String);
		const available = form.getAll('available').map(String);
		try {
			const slug = await tenantSlug(event);
			const saved = await setTenantFeatures(authedClient(event), slug, withheldFrom(offered, available));
			return { featuresSaved: saved.withheld.length };
		} catch (err) {
			return fail(400, { featuresError: actionError(err, 'What this tenant may use could not be saved.') });
		}
	},

	grant: async (event) => {
		await requireRole(event, ['super_admin']);
		const form = await event.request.formData();
		const email = String(form.get('email') ?? '').trim();
		const userId = String(form.get('user_id') ?? '').trim();
		const roles = form.getAll('roles').map(String).filter(Boolean);
		if (!userId && !email) return fail(400, { memberError: 'Name the account by its email.', fields: { email: 'Required' } });
		if (roles.length === 0) return fail(400, { memberError: 'Choose at least one role.', fields: { roles: 'Required' } });
		const client = authedClient(event);
		try {
			let id = userId;
			if (!id) {
				const found = await findUserByEmail(client, email);
				if (!found) {
					return fail(404, { memberError: `No account uses ${email}. Create it on the Users page first.`, fields: { email: 'No such account' } });
				}
				id = found.id;
			}
			await grantMembership(client, id, await tenantSlug(event), roles);
			return { memberSaved: true };
		} catch (err) {
			const full = seatRefusal(err);
			if (full) return fail(402, { memberError: full });
			return fail(400, { memberError: actionError(err, 'The membership could not be saved.') });
		}
	},

	revoke: async (event) => {
		await requireRole(event, ['super_admin']);
		const form = await event.request.formData();
		const userId = String(form.get('user_id') ?? '');
		try {
			await revokeMembership(authedClient(event), userId, await tenantSlug(event));
			return { memberRevoked: true };
		} catch (err) {
			return fail(400, { memberError: actionError(err, 'The membership could not be removed.') });
		}
	},

	archive: async (event) => {
		await requireRole(event, ['super_admin']);
		try {
			await archiveTenant(event.params.id ?? '', authedClient(event));
			return { archived: true };
		} catch (err) {
			return fail(400, { stateError: actionError(err, 'The tenant could not be archived.') });
		}
	},

	restore: async (event) => {
		await requireRole(event, ['super_admin']);
		try {
			await restoreTenant(event.params.id ?? '', authedClient(event));
			return { restored: true };
		} catch (err) {
			return fail(400, { stateError: actionError(err, 'The tenant could not be restored.') });
		}
	},
};
