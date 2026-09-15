import type { PageServerLoad } from './$types';
import { authedClient } from '$lib/server/authz';
import { AI_OK, aiGate, type AiGate } from '$lib/server/ai-load';
import { listPrompts, type PromptView } from '$lib/api/ai';

export const load: PageServerLoad = async (event) => {
	const client = authedClient(event);
	let gate: AiGate = AI_OK;
	let prompts: PromptView[] = [];
	try {
		prompts = await listPrompts(client);
	} catch (err) {
		gate = aiGate(err, event, 'prompts');
	}
	return { gate, prompts };
};
