import type { Actions, PageServerLoad } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { authedClient, requireRole } from '$lib/server/authz';
import { AI_OK, aiActionError, aiGate, type AiGate } from '$lib/server/ai-load';
import { readProviderForm } from '$lib/server/ai-provider-form';
import { pageWindow, pastEndOffset, withOffset } from '$lib/api/list';
import { createProvider, getAiDashboard, listProviders, type AiDashboard, type AiProvider } from '$lib/api/ai';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export const load: PageServerLoad = async (event) => {
	const client = authedClient(event);
	const { limit, offset } = pageWindow(event.url, DEFAULT_LIMIT, MAX_LIMIT);

	let gate: AiGate = AI_OK;
	let providers: AiProvider[] = [];
	let total: number | null = null;
	let hasMore = false;
	try {
		const page = await listProviders(client, { limit: limit + 1, offset });
		providers = page.rows.slice(0, limit);
		total = page.total;
		hasMore = total === null ? page.rows.length > limit : offset + providers.length < total;
	} catch (err) {
		gate = aiGate(err, event, 'providers');
	}

	const back = pastEndOffset(providers.length, limit, offset, total);
	if (back !== null) redirect(307, withOffset(event.url, back));

	// The spend row is a courtesy. A page of providers stands without it.
	const dashboard: AiDashboard | null = gate.state === 'ok' ? await getAiDashboard(client).catch(() => null) : null;

	return { gate, providers, total, limit, offset, hasMore, dashboard };
};

export const actions: Actions = {
	create: async (event) => {
		const user = await requireRole(event, ['super_admin']);
		const client = authedClient(event);
		const data = await event.request.formData();
		const read = readProviderForm(data, null, user.roles.includes('super_admin'));
		if ('error' in read) return fail(400, { error: read.error });
		let created: AiProvider;
		try {
			created = await createProvider(client, read.input);
		} catch (err) {
			return fail(400, { error: aiActionError(err, 'Failed to create the provider') });
		}
		redirect(303, `/admin/ai/providers/${encodeURIComponent(created.id)}`);
	},
};
