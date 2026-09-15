import type { LayoutServerLoad } from './$types';
import { authedClient } from '$lib/server/authz';
import { AI_OK, aiSettingsGate, type AiGate } from '$lib/server/ai-load';
import { getAiSettings, type AiSettings } from '$lib/api/ai';

/**
 * The tenant switch, read once for every tab. It is the one route the switch
 * leaves open, so it is how a tab tells "off" from "not installed", and it is
 * the state the off panel's own switch flips.
 */
export const load: LayoutServerLoad = async (event) => {
	const { user } = await event.parent();
	const client = authedClient(event);
	let aiSettings: AiSettings | null = null;
	let aiLayoutGate: AiGate = AI_OK;
	try {
		aiSettings = await getAiSettings(client);
	} catch (err) {
		aiLayoutGate = aiSettingsGate(err, event);
	}
	return { aiSettings, aiLayoutGate, isSuperAdmin: user.roles.includes('super_admin') };
};
