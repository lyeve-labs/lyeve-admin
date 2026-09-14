/**
 * What the inspector knows about an inline data node without running it:
 * which schema shape is one, and how many rows the typed content will give.
 */

import type { JsonSchema } from './types';
import { propertyList, widgetFor } from './schema';

export const INLINE_FORMATS = ['json', 'yaml', 'csv', 'text', 'table'] as const;
export type InlineFormat = (typeof INLINE_FORMATS)[number];

export function isInlineFormat(v: unknown): v is InlineFormat {
	return typeof v === 'string' && (INLINE_FORMATS as readonly string[]).includes(v);
}

/**
 * A schema the inline editor renders: a `format` enum, a code field whose
 * language follows it, and the grid pair. Matched by shape rather than by
 * node type, so the catalog stays the only authority on what a node is.
 */
export function isInlineDataSchema(schema: JsonSchema): boolean {
	const fields = propertyList(schema);
	const format = fields.find((f) => f.key === 'format');
	if (!format || !Array.isArray(format.schema.enum)) return false;
	const code = fields.some((f) => widgetFor(f.schema) === 'code' && f.schema['x-language'] === '$format');
	const grid = fields.some((f) => widgetFor(f.schema) === 'grid');
	return code && grid;
}

/** Whether the content holds a template segment, in which case nothing can be counted. */
function templated(content: string): boolean {
	return content.includes('{{');
}

/**
 * The row count the engine will produce, or null when it cannot be known
 * here: a template, or JSON that does not parse. A CSV counts its non-empty
 * lines less the header, YAML counts top-level list items, and text is one
 * value. A JSON list is its length and a JSON object is one row.
 */
export function previewCount(format: InlineFormat, content: string, header = true): number | null {
	if (format === 'text') return 1;
	if (templated(content)) return null;
	const lines = content.split('\n').filter((l) => l.trim() !== '');
	if (format === 'csv') {
		if (lines.length === 0) return 0;
		return header ? Math.max(0, lines.length - 1) : lines.length;
	}
	if (format === 'yaml') {
		const items = lines.filter((l) => /^-(\s|$)/.test(l)).length;
		return items > 0 ? items : lines.length > 0 ? 1 : 0;
	}
	if (format === 'json') {
		const trimmed = content.trim();
		if (trimmed === '') return 0;
		try {
			const parsed: unknown = JSON.parse(trimmed);
			return Array.isArray(parsed) ? parsed.length : 1;
		} catch {
			return null;
		}
	}
	return null;
}
