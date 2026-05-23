// Display helpers the client package does not carry, because formatting is
// not its job. Anything that is a table of names belongs in the package
// instead: the AI pages render provider types and capabilities from its
// PROVIDER_TYPES and CAPABILITIES rather than from a copy here.

/** Map a slog.Level integer to its canonical label. */
export function levelName(level: number): string {
	if (level <= -4) return 'DEBUG';
	if (level < 4) return 'INFO';
	if (level < 8) return 'WARN';
	return 'ERROR';
}

/**
 * Extract default values from a JSON Schema by walking `properties` and
 * collecting any `default` values (recursing into nested object properties).
 */
export function extractDefaults(schema: Record<string, unknown>): Record<string, unknown> {
	const defaults: Record<string, unknown> = {};
	const props = schema.properties as Record<string, Record<string, unknown>> | undefined;
	if (!props) return defaults;

	for (const [key, prop] of Object.entries(props)) {
		if ('default' in prop) {
			defaults[key] = prop.default;
		} else if (prop.type === 'object' && prop.properties) {
			defaults[key] = extractDefaults(prop);
		}
	}

	return defaults;
}
