import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { authedClient } from '$lib/server/authz';
import { ApiError } from '@lyeve-labs/client';
import { getPluginSchema } from '@lyeve-labs/client-rest';
import { pluginSettings } from '$lib/config-forms';
import { sessionToken } from '$lib/server/session-cookie';

export interface ConfigSetting {
	key: string;
	source: 'env' | 'file' | 'admin' | 'default' | string;
	value?: string;
	origin?: string;
	editable: boolean;
	secret?: boolean;
	/** What the setting does, when the engine describes it. */
	description?: string;
	/** What applies when no layer sets it. */
	default?: string;
}

interface ConfigProvenance {
	settings: ConfigSetting[];
	counts: Record<string, number>;
	suppressed?: string[];
}

interface ConfigRefusal {
	key: string;
	reason: string;
	origin?: string;
}

export const load: PageServerLoad = async (event) => {
	if (!sessionToken(event)) return { provenance: null };

	const client = authedClient(event);
	const provenance = await client.get<ConfigProvenance>('/api/admin/config').catch(() => null);

	// Opened for one plugin, the page shows that plugin's settings: the ones
	// its schema declares, including those nothing has read yet, which the
	// engine's list cannot know about.
	const pluginName = event.url.searchParams.get('plugin')?.trim() ?? '';
	if (!pluginName || !provenance) return { provenance, plugin: null };
	const schema = await getPluginSchema(pluginName, client).catch(() => null);
	const merged = pluginSettings(provenance.settings, schema);
	return {
		provenance: { ...provenance, settings: merged.settings },
		plugin: { name: pluginName, keys: merged.keys, found: schema !== null },
	};
};

export const actions: Actions = {
	// One setting per submission. Sending the whole table would clear every
	// credential the operator did not retype, because a blank secret is how the
	// engine is told to unset one.
	save: async (event) => {
		const { request } = event;
		if (!sessionToken(event)) return fail(401, { error: 'Not authenticated' });

		const data = await request.formData();
		const key = data.get('key')?.toString()?.trim();
		if (!key) return fail(400, { error: 'Setting name is required' });

		const value = data.get('value')?.toString() ?? '';
		const secret = data.get('secret')?.toString() === 'true';
		if (secret && value === '') {
			return fail(400, { key, error: 'Enter a value, or use Clear to remove the stored one' });
		}

		try {
			const result = await authedClient(event).put<{
				saved?: ConfigSetting[];
				refused?: ConfigRefusal[];
			}>('/api/admin/config', { values: { [key]: value } });

			const refusal = result.refused?.[0];
			if (refusal) {
				const where = refusal.origin ? ` (${refusal.origin})` : '';
				return fail(409, { key, error: `${refusal.reason}${where}` });
			}
			return { success: true, key };
		} catch (e) {
			if (e instanceof ApiError) return fail(e.status, { key, error: e.message });
			return fail(500, { key, error: 'Could not save the setting' });
		}
	},
};
