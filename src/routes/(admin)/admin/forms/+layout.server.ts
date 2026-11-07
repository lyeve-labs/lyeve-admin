import type { LayoutServerLoad } from './$types';
import { getSchemas } from '@lyeve-labs/client-rest';
import { authedClient } from '$lib/server/authz';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning, runs } from '$lib/plugins';
import { section, type Section } from '$lib/api/gate';
import { readSchemaPresets } from '$lib/api/schema-preset-catalog';
import { getSettings, showable, type Settings } from '$lib/api/connected-editors';
import { CONTACT_PRESET, readFlowTargets, type FlowTarget, type SchemaOption } from '$lib/api/builder-forms';

async function readSchemas(client: ReturnType<typeof authedClient>): Promise<SchemaOption[]> {
	const rows = await getSchemas(client);
	const names = showable(rows.map((s) => s.name));
	return rows
		.filter((s) => names.includes(s.name))
		.map((s) => ({
			name: s.name,
			label: s.display_name || s.name,
			delivered: (s as { public_delivery?: unknown }).public_delivery === true,
		}))
		.sort((a, b) => a.label.localeCompare(b.label));
}

/** Whether the schema plugin offers the contact preset. A failed read offers nothing, and the page links the schema builder instead. */
async function contactPresetOffered(client: ReturnType<typeof authedClient>): Promise<boolean> {
	try {
		const { presets } = await readSchemaPresets(client);
		return presets.some((p) => p.id === CONTACT_PRESET);
	} catch {
		return false;
	}
}
/**
 * Where forms can send, and what that is checked against. The flow read
 * costs one request per flow on an event trigger, so it lives here rather
 * than in the page load, which every triage submit reruns. It reads no
 * address, so a filter or a page change does not rerun it either.
 */
export const load: LayoutServerLoad = async (event) => {
	event.depends('forms:flows');
	const { plugins } = await event.parent();
	if (notRunning(plugins, PLUGIN.builder)) {
		return {
			settings: null as Section<Settings> | null,
			schemas: null as Section<SchemaOption[]> | null,
			flows: null as Section<FlowTarget[]> | null,
			presetOffered: false,
		};
	}
	const client = authedClient(event);
	const settings = section(getSettings(client), 'Could not load where forms can send.');
	const schemas = section(readSchemas(client), 'Could not load content types.');
	// Without the flow plugin no flow can start, so forms send only to content types.
	const flows = runs(plugins, PLUGIN.flow) ? section(readFlowTargets(client), 'Could not load flows.') : Promise.resolve(null);
	const presetOffered = runs(plugins, PLUGIN.schema) ? contactPresetOffered(client) : Promise.resolve(false);
	return { settings: await settings, schemas: await schemas, flows: await flows, presetOffered: await presetOffered };
};
