import type { SchemaField } from '@lyeve-labs/client';
import { entryTitle } from './entry-identity';

/**
 * The identity columns POST /api/admin/content requires beside the body.
 *
 * The admin store keeps title and slug as columns on the entry, not as part of
 * the body, and refuses a create that carries neither. The body still carries
 * both when the schema declares them: the engine validates the body against the
 * schema, so a title that exists only as a column fails the schema's own
 * required check, and a title that exists only in the body never reads back,
 * because the listing overlays the column on top of the body. The editor writes
 * it twice for the same reason.
 */
export interface EntryIdentity {
	title: string;
	slug: string;
}

/** What the listing calls an entry it cannot find a name for. */
export const UNTITLED = 'Untitled entry';

/**
 * Turn text into something that can sit in a URL.
 *
 * Diacritics are decomposed and their marks dropped, so "Café Menu" becomes
 * "cafe-menu" rather than losing the word. Anything else outside a-z, 0-9 and
 * the hyphen is a separator. The store normalizes a slug to Unicode NFC and
 * refuses control characters and percent signs, none of which survive this.
 */
export function slugify(text: string): string {
	return text
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 80);
}

/**
 * Six characters of entropy, appended to a slug the operator never sees.
 *
 * A derived slug has no author behind it to resolve a collision: the schema
 * declares no slug field, so nothing on the form could be edited to get past a
 * 409. Two entries named "Contact form" are an ordinary thing to want.
 */
function disambiguator(): string {
	return Math.random().toString(36).slice(2, 8).padEnd(6, '0');
}

/**
 * Name a new entry the way the listing will label it.
 *
 * `entryTitle` is the one place that decides what an operator recognizes an
 * entry by: its own title, then its slug, then whichever conventional name
 * field the schema declares, in schema order. Deriving the stored title from
 * the same function is what keeps the row reading as the thing the operator
 * just typed rather than as eight characters of a UUID.
 *
 * A schema that offers no name at all still creates. The store requires a
 * title, so the fallback is the string the listing already prints for an entry
 * it cannot name, and the product says one thing in both places.
 */
export function entryIdentity(
	data: Record<string, unknown>,
	fields: readonly SchemaField[],
): EntryIdentity {
	const named = entryTitle({ id: '', data }, fields);
	const title = named.source === 'none' ? UNTITLED : named.label;

	// A slug the operator typed is theirs, including its collisions: the field
	// is on the form and the conflict message names it, so they can fix it.
	const authored = typeof data.slug === 'string' ? data.slug.trim() : '';
	if (authored) return { title, slug: authored };

	const stem = slugify(title) || 'entry';
	return { title, slug: `${stem}-${disambiguator()}` };
}
