import type { PageServerLoad, Actions } from './$types';
import { fail } from '@sveltejs/kit';
import { authedClient, requireRole } from '$lib/server/authz';
import { actionError } from '$lib/server/action-error';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning } from '$lib/plugins';
import {
	STORAGE_OK,
	createProvider,
	deleteProvider,
	providerBodyFrom,
	updateProvider,
	listProviders,
	storageGate,
	testMessage,
	testPassed,
	testProvider,
	type StorageGate,
	type StorageProvider,
} from '$lib/api/storage';
import { rowsOf } from '$lib/api/list';

export const load: PageServerLoad = async (event) => {
	const { plugins, user } = await event.parent();
	// Creating and changing a provider is super admin only on the engine, so
	// the form is offered to super admins only.
	const canConfigure = (user?.roles ?? []).includes('super_admin');

	const client = authedClient(event);
	let providers: StorageProvider[] = [];
	// The shell says why the page is unavailable while its plugin does not run.
	let gate: StorageGate = notRunning(plugins, PLUGIN.storage) ? { state: 'absent' } : STORAGE_OK;
	if (gate.state === 'ok') {
		try {
			providers = rowsOf(await listProviders(client));
		} catch (err) {
			gate = storageGate(err);
		}
	}

	return { providers, gate, canConfigure };
};

export const actions: Actions = {
	// The test route can report success under either of two field names.
	// Reading one of them treats a refusal as a pass, so both are read and the
	// absence of an explicit success is not success.
	test: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		const client = authedClient(event);
		const form = await event.request.formData();
		const id = String(form.get('id') ?? '');
		if (!id) return fail(400, { error: 'No provider was named.' });
		try {
			const result = await testProvider(client, id);
			if (!testPassed(result)) {
				return fail(400, { error: `The provider refused: ${testMessage(result)}` });
			}
			return { tested: id };
		} catch (err) {
			return fail(400, { error: actionError(err, 'The provider could not be tested.') });
		}
	},

	create: async (event) => {
		await requireRole(event, ['super_admin']);
		const parsed = providerBodyFrom(await event.request.formData(), true);
		if ('error' in parsed) return fail(400, { providerError: parsed.error });
		try {
			const created = await createProvider(authedClient(event), parsed.body);
			return { saved: created.name ?? parsed.body.name };
		} catch (err) {
			return fail(400, { providerError: actionError(err, 'The provider could not be created.') });
		}
	},

	update: async (event) => {
		await requireRole(event, ['super_admin']);
		const form = await event.request.formData();
		const id = String(form.get('id') ?? '');
		if (!id) return fail(400, { providerError: 'No provider was named.' });
		const parsed = providerBodyFrom(form, false);
		if ('error' in parsed) return fail(400, { providerError: parsed.error });
		try {
			await updateProvider(authedClient(event), id, parsed.body);
			return { saved: parsed.body.name };
		} catch (err) {
			return fail(400, { providerError: actionError(err, 'The provider could not be saved.') });
		}
	},

	delete: async (event) => {
		await requireRole(event, ['super_admin']);
		const client = authedClient(event);
		const form = await event.request.formData();
		const id = String(form.get('id') ?? '');
		if (!id) return fail(400, { error: 'No provider was named.' });
		try {
			await deleteProvider(client, id);
		} catch (err) {
			return fail(400, { error: actionError(err, 'The provider could not be removed.') });
		}
		return { removed: id };
	},
};
