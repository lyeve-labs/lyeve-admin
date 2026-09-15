import type { Actions, PageServerLoad } from './$types';
import { fail } from '@sveltejs/kit';
import { ApiError } from '@lyeve-labs/client';
import { authedClient, requireRole, requireUser } from '$lib/server/authz';
import { aiActionError } from '$lib/server/ai-load';
import { putAiSettings } from '$lib/api/ai';

/** The retention window and the instance switch, as the config route states them. */
export interface InstanceSetting {
	key: string;
	value: string;
	source: string;
	editable: boolean;
}

interface ConfigProvenance {
	settings: { key: string; source: string; value?: string; editable: boolean }[];
}

const INSTANCE_KEYS = ['ai_transcript_retention', 'ai_transcripts_enabled'];
const DEFAULTS: Record<string, string> = { ai_transcript_retention: '720h', ai_transcripts_enabled: 'true' };

/**
 * The switch itself comes from the layout. What this load adds is the
 * instance side of retention: the config route is super_admin only and its
 * absence is not a failure of the page, so a refusal leaves the defaults
 * with their source named.
 */
export const load: PageServerLoad = async (event) => {
	const { user } = await event.parent();
	let instance: InstanceSetting[] = INSTANCE_KEYS.map((key) => ({ key, value: DEFAULTS[key], source: 'default', editable: false }));
	let instanceReadable = false;
	if (user.roles.includes('super_admin')) {
		const provenance = await authedClient(event)
			.get<ConfigProvenance>('/api/admin/config')
			.catch(() => null);
		if (provenance) {
			instanceReadable = true;
			instance = INSTANCE_KEYS.map((key) => {
				const s = provenance.settings.find((x) => x.key === key);
				return { key, value: s?.value ?? DEFAULTS[key], source: s?.source ?? 'default', editable: s?.editable ?? false };
			});
		}
	}
	return { instance, instanceReadable };
};

export const actions: Actions = {
	// One switch per submission. The plugin keeps whatever the body omits, so a
	// form that names one switch cannot flip the other.
	save: async (event) => {
		await requireUser(event);
		const data = await event.request.formData();
		const body: { enabled?: boolean; transcripts_enabled?: boolean } = {};
		if (data.has('enabled')) body.enabled = String(data.get('enabled')) === 'true';
		if (data.has('transcripts_enabled')) body.transcripts_enabled = String(data.get('transcripts_enabled')) === 'true';
		if (body.enabled === undefined && body.transcripts_enabled === undefined) {
			return fail(400, { scope: 'switch', error: 'Nothing to change.' });
		}
		try {
			const settings = await putAiSettings(authedClient(event), body);
			return { scope: 'switch', settings };
		} catch (err) {
			return fail(400, { scope: 'switch', error: aiActionError(err, 'The setting could not be saved') });
		}
	},

	config: async (event) => {
		await requireRole(event, ['super_admin']);
		const data = await event.request.formData();
		const key = String(data.get('key') ?? '').trim();
		if (!INSTANCE_KEYS.includes(key)) return fail(400, { scope: 'config', key, error: 'Not a setting this page edits.' });
		const value = String(data.get('value') ?? '').trim();
		if (key === 'ai_transcript_retention' && !/^\d+(?:\.\d+)?(?:h|m|s)$/.test(value)) {
			return fail(400, { scope: 'config', key, error: 'Retention is a Go duration such as 720h; the minimum is 1h.' });
		}
		try {
			const result = await authedClient(event).put<{ refused?: { key: string; reason: string; origin?: string }[] }>('/api/admin/config', {
				values: { [key]: value },
			});
			const refusal = result.refused?.[0];
			if (refusal) return fail(409, { scope: 'config', key, error: refusal.origin ? `${refusal.reason} (${refusal.origin})` : refusal.reason });
			return { scope: 'config', key, success: true };
		} catch (err) {
			if (err instanceof ApiError) return fail(err.status, { scope: 'config', key, error: aiActionError(err, 'Could not save the setting') });
			return fail(500, { scope: 'config', key, error: 'Could not save the setting' });
		}
	},
};
