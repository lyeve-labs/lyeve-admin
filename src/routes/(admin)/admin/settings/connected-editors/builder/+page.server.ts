import type { Actions, PageServerLoad } from './$types';
import { error, fail } from '@sveltejs/kit';
import { ApiError } from '@lyeve-labs/client';
import { authedClient } from '$lib/server/authz';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning } from '$lib/plugins';
import { forbiddenText, gateOf, GATE_OK, isOutage, section, type Gate, type Section } from '$lib/api/gate';
import { bodyString, errorCodeOf } from '$lib/api/limits';
import { listSchemaNames } from '$lib/api/search-settings';
import {
	LIFETIMES,
	SAID,
	WITHHELD,
	getSettings,
	saveSettings,
	showable,
	type ConnectionsGate,
	type Settings,
	type SettingsPatch,
} from '$lib/api/connected-editors';
import { OWNER_ROLES, isOwner, refusalSentence } from '../shared.server';

/** What a refused settings read means. A tenant the plugin is withheld from gets the area's own notice. */
function settingsGate(err: unknown): ConnectionsGate {
	if (err instanceof ApiError && err.status === 403 && errorCodeOf(err) === WITHHELD) return { state: 'withheld' };
	return gateOf(err, 'Could not load the builder settings.');
}

export const load: PageServerLoad = async (event) => {
	const { plugins, user } = await event.parent();
	// The settings route answers owners only, so nobody else opens the page.
	if (!isOwner(user?.roles)) error(403, forbiddenText('this page', OWNER_ROLES));

	// The shell says why the page is unavailable while its plugin does not run.
	if (notRunning(plugins, PLUGIN.builder)) {
		return {
			gate: { state: 'absent' } as ConnectionsGate,
			settings: null as Section<Settings> | null,
			schemas: [] as string[],
			schemasGate: null as Gate | null,
		};
	}

	const client = authedClient(event);
	const schemas = section(listSchemaNames(client), 'Could not load schemas. Pages keep showing the schemas saved before.');
	const read = await section(getSettings(client), settingsGate);
	const schemaList = await schemas;
	// A tenant the plugin is withheld from is the page's gate, and every other
	// refusal stays on the settings.
	if (!read.ok && read.gate.state === 'withheld') {
		return { gate: read.gate as ConnectionsGate, settings: null, schemas: [] as string[], schemasGate: null };
	}
	return {
		gate: GATE_OK as ConnectionsGate,
		settings: read as Section<Settings>,
		schemas: schemaList.ok ? showable(schemaList.value) : [],
		schemasGate: schemaList.ok ? null : schemaList.gate,
	};
};

function setting(form: FormData): { field: string; patch?: SettingsPatch; error?: string } {
	const field = String(form.get('field') ?? '');
	switch (field) {
		case 'allowed': {
			const v = String(form.get('allowed') ?? '');
			if (v !== 'on' && v !== 'off') return { field, error: 'Choose On or Off.' };
			return { field, patch: { allowed: v === 'on' } };
		}
		// Everything but the switch saves together. A refusal names the field it lands on.
		case 'limits': {
			const lifetime = Number(form.get('lifetime_days'));
			if (!(LIFETIMES as readonly number[]).includes(lifetime)) {
				return { field: 'lifetime_days', error: 'Choose 30, 90 or 180 days.' };
			}
			const raw = String(form.get('writes_per_minute') ?? '').trim();
			const writes = Number(raw);
			if (!raw || !Number.isInteger(writes)) {
				return { field: 'writes_per_minute', error: 'Enter a whole number of writes a minute.' };
			}
			const patch: SettingsPatch = { lifetime_days: lifetime, writes_per_minute: writes };
			// A form whose schema list failed to load offered none, and must not clear them.
			if (form.get('schemas_offered')) patch.show_schemas = form.getAll('show_schemas').map(String).filter(Boolean);
			return { field, patch };
		}
		default:
			return { field: '', error: 'This form is missing its setting. Reload the page and try again.' };
	}
}

// No requireRole here. The engine answers the settings route for owners only.
export const actions: Actions = {
	setting: async (event) => {
		const form = await event.request.formData();
		const { field, patch, error } = setting(form);
		if (!patch) return fail(400, { settingError: { field, message: error ?? '' } });
		try {
			return { saved: { field, settings: await saveSettings(authedClient(event), patch) } };
		} catch (e) {
			if (errorCodeOf(e) === 'settings_invalid') {
				return fail(422, { settingError: { field: bodyString(e, 'field') || field, message: (e as ApiError).message } });
			}
			if (isOutage(e)) return fail(503, { settingError: { field, message: SAID.settingOutage } });
			return fail(e instanceof ApiError ? e.status : 400, {
				settingError: { field, message: refusalSentence(e, 'Could not save the setting. Try again.') },
			});
		}
	},
};
