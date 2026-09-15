import type { Actions, PageServerLoad } from './$types';
import { error, fail } from '@sveltejs/kit';
import { ApiError } from '@lyeve-labs/client';
import { authedClient, requireUser } from '$lib/server/authz';
import { AI_OK, aiActionError, aiGate, type AiGate } from '$lib/server/ai-load';
import { getPrompt, savePromptVersion, type PromptView } from '$lib/api/ai';

export const load: PageServerLoad = async (event) => {
	const { aiSettings } = await event.parent();
	const client = authedClient(event);
	let gate: AiGate = AI_OK;
	let prompt: PromptView | null = null;
	try {
		prompt = await getPrompt(client, event.params.use_case);
	} catch (err) {
		if (err instanceof ApiError && err.status === 404 && aiSettings?.enabled !== false) {
			error(404, 'Unknown prompt use case');
		}
		gate = aiGate(err, event, 'prompts');
	}
	return { gate, prompt };
};

export const actions: Actions = {
	save: async (event) => {
		await requireUser(event);
		const data = await event.request.formData();
		const body = String(data.get('body') ?? '');
		if (!body.trim()) return fail(400, { scope: 'save', error: 'The prompt cannot be empty.' });
		try {
			const saved = await savePromptVersion(authedClient(event), event.params.use_case, body);
			return { scope: 'save', version: saved.version };
		} catch (err) {
			return fail(400, { scope: 'save', error: aiActionError(err, 'Failed to save the prompt') });
		}
	},

	// The plugin has no "make current" route: the one in force is the newest
	// row, so an older version comes back as a new version with its text.
	restore: async (event) => {
		await requireUser(event);
		const client = authedClient(event);
		const data = await event.request.formData();
		const version = Number(data.get('version'));
		if (!Number.isInteger(version) || version < 0) return fail(400, { scope: 'restore', error: 'Choose a version.' });
		let view: PromptView;
		try {
			view = await getPrompt(client, event.params.use_case);
		} catch (err) {
			return fail(400, { scope: 'restore', error: aiActionError(err, 'The prompt could not be read') });
		}
		const body = version === 0 ? view.default : view.versions.find((v) => v.version === version)?.body;
		if (body === undefined) return fail(404, { scope: 'restore', error: `Version ${version} does not exist.` });
		try {
			const saved = await savePromptVersion(client, event.params.use_case, body);
			return { scope: 'restore', version: saved.version, from: version };
		} catch (err) {
			return fail(400, { scope: 'restore', error: aiActionError(err, 'Failed to restore the version') });
		}
	},
};
