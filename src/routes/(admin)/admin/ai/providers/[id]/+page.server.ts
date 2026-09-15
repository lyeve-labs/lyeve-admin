import type { Actions, PageServerLoad, RequestEvent } from './$types';
import { error, fail, redirect } from '@sveltejs/kit';
import { ApiError } from '@lyeve-labs/client';
import { authedClient, requireRole, requireUser } from '$lib/server/authz';
import { AI_OK, aiActionError, aiGate, type AiGate } from '$lib/server/ai-load';
import { readProviderForm } from '$lib/server/ai-provider-form';
import { deleteProvider, getCapabilities, getProvider, listModels, updateProvider, type AiProvider } from '$lib/api/ai';

export const load: PageServerLoad = async (event) => {
	const { aiSettings } = await event.parent();
	const client = authedClient(event);
	let gate: AiGate = AI_OK;
	let provider: AiProvider | null = null;
	try {
		provider = await getProvider(client, event.params.id);
	} catch (err) {
		// The tenant gate and a missing row both answer 404. The settings read
		// from the layout, which the gate leaves open, says which it was.
		if (err instanceof ApiError && err.status === 404 && aiSettings?.enabled !== false) {
			error(404, 'Provider not found');
		}
		gate = aiGate(err, event, 'providers');
	}
	return { gate, provider };
};

async function existing(event: RequestEvent): Promise<AiProvider | null> {
	return getProvider(authedClient(event), event.params.id).catch(() => null);
}

export const actions: Actions = {
	update: async (event) => {
		const user = await requireRole(event, ['super_admin']);
		const client = authedClient(event);
		const data = await event.request.formData();
		const read = readProviderForm(data, await existing(event), user.roles.includes('super_admin'));
		if ('error' in read) return fail(400, { scope: 'config', error: read.error });
		try {
			await updateProvider(client, event.params.id, read.input);
		} catch (err) {
			return fail(400, { scope: 'config', error: aiActionError(err, 'Failed to save the provider') });
		}
		return { scope: 'config', saved: true };
	},

	delete: async (event) => {
		await requireRole(event, ['super_admin']);
		try {
			await deleteProvider(authedClient(event), event.params.id);
		} catch (err) {
			return fail(400, { scope: 'delete', error: aiActionError(err, 'Failed to delete the provider') });
		}
		redirect(303, '/admin/ai/providers');
	},

	// Reads a button asks for: the provider's own model list and what one
	// model can do. Both are answered on the form prop and never stored.
	models: async (event) => {
		await requireUser(event);
		try {
			const models = await listModels(authedClient(event), event.params.id);
			return { scope: 'models', models };
		} catch (err) {
			return fail(400, { scope: 'models', error: aiActionError(err, 'The provider did not answer with its models') });
		}
	},

	capabilities: async (event) => {
		await requireUser(event);
		const data = await event.request.formData();
		const model = String(data.get('model') ?? '').trim() || undefined;
		try {
			const capabilities = await getCapabilities(authedClient(event), event.params.id, model);
			return { scope: 'capabilities', capabilities };
		} catch (err) {
			return fail(400, { scope: 'capabilities', error: aiActionError(err, 'The capabilities could not be read') });
		}
	},
};
