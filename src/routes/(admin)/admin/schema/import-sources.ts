/**
 * Where imported definitions can come from, as the engine's `from` parameter
 * names them, with the words a person picks them by.
 */
export const IMPORT_SOURCES = [
	{ value: 'lyeve', label: 'LyEve export (YAML or JSON)' },
	{ value: 'json-schema', label: 'JSON Schema' },
	{ value: 'openapi', label: 'OpenAPI or Swagger components' },
	{ value: 'strapi', label: 'Strapi content types' },
	{ value: 'contentful', label: 'Contentful content model' },
	{ value: 'wordpress', label: 'WordPress (an ACF field-group export)' },
] as const;

export type ImportSource = (typeof IMPORT_SOURCES)[number]['value'];
