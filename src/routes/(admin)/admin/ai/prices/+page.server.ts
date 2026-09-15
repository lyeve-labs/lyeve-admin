import type { Actions, PageServerLoad } from './$types';
import { fail } from '@sveltejs/kit';
import { authedClient, requireRole } from '$lib/server/authz';
import { AI_OK, aiActionError, aiGate, type AiGate } from '$lib/server/ai-load';
import { deletePrice, listPrices, putPrice, PROVIDER_KINDS, type ModelPrice } from '$lib/api/ai';

export const load: PageServerLoad = async (event) => {
	const client = authedClient(event);
	let gate: AiGate = AI_OK;
	let prices: ModelPrice[] = [];
	try {
		prices = await listPrices(client);
	} catch (err) {
		gate = aiGate(err, event, 'prices');
	}
	return { gate, prices };
};

function money(data: FormData, key: string): number | null {
	const raw = String(data.get(key) ?? '').trim();
	if (raw === '') return 0;
	const n = Number(raw);
	return Number.isFinite(n) && n >= 0 ? n : null;
}

export const actions: Actions = {
	save: async (event) => {
		await requireRole(event, ['super_admin']);
		const data = await event.request.formData();
		const kind = String(data.get('kind') ?? '').trim();
		const model = String(data.get('model') ?? '').trim();
		const key = `${kind}/${model}`;
		if (!(PROVIDER_KINDS as readonly string[]).includes(kind)) return fail(400, { key, error: 'Choose a provider kind.' });
		if (!model) return fail(400, { key, error: 'Model is required.' });
		const input = money(data, 'input_per_1k');
		const output = money(data, 'output_per_1k');
		const image = money(data, 'image_per_call');
		if (input === null || output === null || image === null) {
			return fail(400, { key, error: 'A price is a number of dollars, 0 or more.' });
		}
		try {
			await putPrice(authedClient(event), kind, model, { input_per_1k: input, output_per_1k: output, image_per_call: image });
			return { key, saved: true };
		} catch (err) {
			return fail(400, { key, error: aiActionError(err, 'Failed to save the price') });
		}
	},

	delete: async (event) => {
		await requireRole(event, ['super_admin']);
		const data = await event.request.formData();
		const kind = String(data.get('kind') ?? '').trim();
		const model = String(data.get('model') ?? '').trim();
		const key = `${kind}/${model}`;
		try {
			await deletePrice(authedClient(event), kind, model);
			return { key, deleted: true };
		} catch (err) {
			return fail(400, { key, error: aiActionError(err, 'Failed to delete the price') });
		}
	},
};
