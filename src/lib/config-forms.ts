/**
 * How one setting is written in each place the engine reads it from. Every
 * layer resolves to the upper-case environment name. The configuration file
 * takes the same name in lower case, or nested with each underscore a level,
 * and both resolve to one key.
 */
export interface SettingForms {
	env: string;
	file: string;
}

export function settingForms(key: string, value = '<value>'): SettingForms {
	const env = key.trim().toUpperCase();
	return { env: `${env}=${value}`, file: `${env.toLowerCase()}: ${value}` };
}

/** Whether a setting matches a filter, by its name or what it does. */
export function settingMatches(s: { key: string; description?: string }, filter: string): boolean {
	const q = filter.trim().toLowerCase();
	if (!q) return true;
	return s.key.toLowerCase().includes(q) || (s.description ?? '').toLowerCase().includes(q);
}

/** A setting as the configuration page lists it. */
export interface ListedSetting {
	key: string;
	source: string;
	value?: string;
	origin?: string;
	editable: boolean;
	secret?: boolean;
	description?: string;
	default?: string;
}

interface SchemaProperty {
	description?: string;
	default?: unknown;
	format?: string;
	writeOnly?: boolean;
}

/** The resolver's name for a key: upper case, dots and dashes as underscores. */
export function resolvedName(key: string): string {
	return key.trim().replace(/[.\- ]/g, '_').toUpperCase();
}

/**
 * The settings a plugin declares, merged into the engine's list. A key the
 * engine already lists keeps its provenance and takes the schema's
 * description only when it has none. A key nothing has read yet is added as
 * unset and editable, since the admin layer takes any name.
 */
export function pluginSettings(
	settings: ListedSetting[],
	schema: { properties?: Record<string, SchemaProperty> } | null,
): { settings: ListedSetting[]; keys: string[] } {
	const props = schema?.properties ?? {};
	const keys = Object.keys(props).map(resolvedName);
	const byKey = new Map(settings.map((s) => [s.key, s]));
	const out = settings.map((s) => {
		const prop = Object.entries(props).find(([k]) => resolvedName(k) === s.key)?.[1];
		return prop && !s.description ? { ...s, description: prop.description } : s;
	});
	for (const [raw, prop] of Object.entries(props)) {
		const key = resolvedName(raw);
		if (byKey.has(key)) continue;
		out.push({
			key,
			source: 'default',
			editable: true,
			secret: prop.writeOnly === true || prop.format === 'password',
			description: prop.description,
			default: prop.default === undefined ? undefined : String(prop.default),
		});
	}
	return { settings: out, keys };
}
