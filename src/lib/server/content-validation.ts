import { ApiError } from '@lyeve-labs/client';

/** What a form action returns when the content plugin refused the values. */
export interface FieldRefusal {
	/** The banner sentence, with any message that names no field on the form. */
	error: string;
	/** The plugin's message for each field the form shows, by field name. */
	fieldErrors: Record<string, string>;
}

/** One entry of the plugin's 422 body. */
interface ValidationEntry {
	field?: unknown;
	message?: unknown;
}

const CHECK_FIELDS = 'The entry was not saved. Check the highlighted fields.';

/**
 * The per-field messages of a 422 from the content plugin, or null for any
 * other failure.
 *
 * The plugin answers a value the schema refuses with an `errors` array and no
 * `error` key, so the client's message is the raw body text. Relayed as is,
 * the banner shows JSON and no field is marked. A message for a field the
 * form does not show stays in the banner, because a count of fields that
 * need attention would otherwise point at nothing on the screen.
 */
export function fieldRefusalOf(err: unknown, shown: string[]): FieldRefusal | null {
	if (!(err instanceof ApiError) || err.status !== 422) return null;
	const entries = (err.body as { errors?: unknown } | undefined)?.errors;
	if (!Array.isArray(entries) || entries.length === 0) return null;

	const onForm = new Set(shown);
	const fieldErrors: Record<string, string> = {};
	const elsewhere: string[] = [];
	for (const entry of entries as ValidationEntry[]) {
		const field = typeof entry?.field === 'string' ? entry.field : '';
		const message = typeof entry?.message === 'string' ? entry.message.trim() : '';
		if (!message) continue;
		if (field && onForm.has(field)) {
			fieldErrors[field] ??= message;
		} else {
			elsewhere.push(field ? `${field}: ${message}` : message);
		}
	}
	if (Object.keys(fieldErrors).length === 0 && elsewhere.length === 0) return null;

	const lead = Object.keys(fieldErrors).length > 0 ? CHECK_FIELDS : 'The entry was not saved.';
	return { error: [lead, ...elsewhere.map((m) => (/[.!?]$/.test(m) ? m : `${m}.`))].join(' '), fieldErrors };
}
