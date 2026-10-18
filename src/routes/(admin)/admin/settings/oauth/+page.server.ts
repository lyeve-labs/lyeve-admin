import type { PageServerLoad, Actions } from './$types';
import { listOAuthProviders, createOAuthProvider, updateOAuthProvider, deleteOAuthProvider } from '@lyeve-labs/client-rest';
import { authedClient, loadUser, requireRole } from '$lib/server/authz';
import { fail, error, type ActionFailure } from '@sveltejs/kit';
import { actionFailure } from '$lib/server/action-error';
import { section } from '$lib/api/gate';

export const load: PageServerLoad = async (event) => {
	const user = await loadUser(event);
	if (!user.roles.includes('super_admin')) error(403, 'Requires super_admin role');
	const client = authedClient(event);
	const providers = await section(
		listOAuthProviders(client),
		'The OAuth providers could not be read. This is not a report that there are none.'
	);
	return { providers };
};

/**
 * The failure marked with the action that caused it. The page shows a failed
 * delete beside the list and a failed save in its drawer, and never one in
 * the other's place.
 */
function tagged<T extends Record<string, unknown>>(action: string, failure: ActionFailure<T>) {
	return fail(failure.status, { ...failure.data, action });
}

export const actions: Actions = {
	create: async (event) => {
		await requireRole(event, ['super_admin']);
		const { request } = event;
		const form = await request.formData();
		const client = authedClient(event);

		const scopesRaw = form.get('scopes') as string;
		const defaultRolesRaw = form.get('default_roles') as string;

		try {
			await createOAuthProvider(
				{
					name: (form.get('name') as string) ?? '',
					client_id: (form.get('client_id') as string) ?? '',
					client_secret: (form.get('client_secret') as string) ?? '',
					issuer_url: (form.get('issuer_url') as string) ?? '',
					scopes: scopesRaw ? scopesRaw.split(',').map((s) => s.trim()).filter(Boolean) : ['openid', 'email', 'profile'],
					roles_claim: (form.get('roles_claim') as string) || 'roles',
					default_roles: defaultRolesRaw ? defaultRolesRaw.split(',').map((s) => s.trim()).filter(Boolean) : ['editor'],
					enabled: form.get('enabled') === 'true',
				},
				client,
			);
		} catch (e: unknown) {
			return tagged('create', actionFailure(e, 'The provider could not be created.'));
		}
		return { success: true };
	},

	update: async (event) => {
		await requireRole(event, ['super_admin']);
		const { request } = event;
		const form = await request.formData();
		const client = authedClient(event);
		const id = form.get('id') as string;

		const scopesRaw = form.get('scopes') as string;
		const defaultRolesRaw = form.get('default_roles') as string;
		const secret = form.get('client_secret') as string;

		const payload: Record<string, unknown> = {
			name: form.get('name'),
			client_id: form.get('client_id'),
			issuer_url: form.get('issuer_url'),
			scopes: scopesRaw ? scopesRaw.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
			roles_claim: (form.get('roles_claim') as string) || 'roles',
			default_roles: defaultRolesRaw ? defaultRolesRaw.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
			enabled: form.get('enabled') === 'true',
		};
		if (secret) payload['client_secret'] = secret;

		try {
			await updateOAuthProvider(id, payload as Parameters<typeof updateOAuthProvider>[1], client);
		} catch (e: unknown) {
			return tagged('update', actionFailure(e, 'The provider could not be saved.'));
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
			await deleteOAuthProvider(id, client);
		} catch (e: unknown) {
			return tagged('delete', actionFailure(e, 'The provider could not be deleted.'));
		}
		return { success: true };
	},
};

