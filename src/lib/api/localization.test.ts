import { describe, expect, it, vi } from 'vitest';
import type { SchemaField } from '@lyeve-labs/client';
import {
	completenessOf,
	getLocales,
	listTranslations,
	putLocales,
	toLocalePreferences,
	toTranslation,
	translatableFields,
	translationInput,
	translationValues,
	usesMarkedFields,
	updateTranslation,
} from './localization';

const field = (name: string, field_type: SchemaField['field_type'], extra: Partial<SchemaField> = {}): SchemaField => ({
	name,
	field_type,
	required: false,
	unique: false,
	indexed: false,
	...extra,
});

const FIELDS = [
	field('title', 'text'),
	field('body', 'rich_text'),
	field('price', 'number'),
	field('created_at', 'datetime', { system: true }),
	field('slug', 'text', { system: true }),
];

describe('translatableFields', () => {
	it('keeps the text and rich text fields the operator writes', () => {
		expect(translatableFields(FIELDS).map((f) => f.name)).toEqual(['title', 'body']);
	});
});

describe('translationValues', () => {
	it('flattens a row the way the entry is flattened: body, then the title column', () => {
		const t = toTranslation({
			locale: 'fr',
			title: 'Bonjour',
			body: { title: 'stale', body: '<p>Salut</p>' },
			translation_status: 'translated',
		});
		expect(translationValues(t, translatableFields(FIELDS))).toEqual({
			title: 'Bonjour',
			body: '<p>Salut</p>',
		});
	});

	it('gives every field an empty string when the locale holds nothing yet', () => {
		expect(translationValues(undefined, translatableFields(FIELDS))).toEqual({ title: '', body: '' });
	});
});

describe('translationInput', () => {
	it('writes the title to its column and to the body both', () => {
		expect(translationInput({ title: 'Bonjour', body: '<p>Salut</p>', n: 3 })).toEqual({
			title: 'Bonjour',
			body: { title: 'Bonjour', body: '<p>Salut</p>' },
		});
	});
});

describe('toTranslation', () => {
	it('reads an unknown status as draft and a non-object body as empty', () => {
		const t = toTranslation({ locale: 'de', body: 'not json', translation_status: 'weird' });
		expect(t.translation_status).toBe('draft');
		expect(t.body).toEqual({});
		expect(t.title).toBe('');
	});
});

describe('toLocalePreferences', () => {
	it('tolerates a plugin that sends no chain', () => {
		expect(toLocalePreferences({ default_locale: 'en', enabled_locales: ['en', 'fr'] })).toEqual({
			default_locale: 'en',
			enabled_locales: ['en', 'fr'],
			fallback_chain: [],
		});
	});
});

function client() {
	return { get: vi.fn(), put: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() };
}

describe('the wrappers', () => {
	it('lists translations from the paginated envelope', async () => {
		const c = client();
		c.get.mockResolvedValue({ data: [{ locale: 'fr', translation_status: 'outdated' }], total: 1 });
		const rows = await listTranslations(c as never, 'e 1');
		expect(c.get).toHaveBeenCalledWith('/api/admin/content/e%201/translations?limit=100&offset=0');
		expect(rows.map((r) => [r.locale, r.translation_status])).toEqual([['fr', 'outdated']]);
	});

	it('updates one locale by its route and returns the row', async () => {
		const c = client();
		c.put.mockResolvedValue({ locale: 'fr', translation_status: 'translated' });
		const row = await updateTranslation(c as never, 'e1', 'fr', { translation_status: 'translated' });
		expect(c.put).toHaveBeenCalledWith('/api/admin/content/e1/translations/fr', {
			translation_status: 'translated',
		});
		expect(row.translation_status).toBe('translated');
	});

	it('reads and writes the locale preferences on one route', async () => {
		const c = client();
		c.get.mockResolvedValue({ default_locale: 'en', enabled_locales: ['en'] });
		expect(await getLocales(c as never)).toEqual({
			default_locale: 'en',
			enabled_locales: ['en'],
			fallback_chain: [],
		});
		expect(c.get).toHaveBeenCalledWith('/api/admin/localization/locales');

		// A plugin that answers a PUT with a message and no body keeps what was
		// sent. One that echoes the row wins over it.
		c.put.mockResolvedValue({ message: 'ok' });
		const prefs = { default_locale: 'en', enabled_locales: ['en', 'fr'], fallback_chain: ['fr'] };
		expect(await putLocales(c as never, prefs)).toEqual(prefs);
		expect(c.put).toHaveBeenCalledWith('/api/admin/localization/locales', prefs);
	});
});

/*
 * Which fields a translation carries.
 *
 * A field says so with `localized` in the schema. A schema with no field
 * marked falls back to a guess from the type.
 */
describe('translatableFields with the mark', () => {
	const f = (name: string, field_type: string, over: Record<string, unknown> = {}) =>
		({ name, field_type, required: false, unique: false, indexed: false, ...over }) as SchemaField;

	it('takes the marked fields when the schema has been marked', () => {
		const got = translatableFields([
			f('title', 'text', { localized: true }),
			f('slug', 'text'),
			f('body', 'rich_text', { localized: true }),
		]);
		expect(got.map((x) => x.name)).toEqual(['title', 'body']);
	});

	// A schema nobody has marked would otherwise show an empty panel, which
	// reads as translation having been switched off.
	it('falls back to the type guess when nothing is marked', () => {
		const got = translatableFields([f('title', 'text'), f('views', 'number'), f('body', 'rich_text')]);
		expect(got.map((x) => x.name)).toEqual(['title', 'body']);
	});

	it('never offers a system field, marked or not', () => {
		const got = translatableFields([
			f('id', 'uid', { system: true, localized: true }),
			f('title', 'text', { localized: true }),
		]);
		expect(got.map((x) => x.name)).toEqual(['title']);
	});

	// The mark is the point: a marked schema offers only what was marked, even
	// where a text field sits right beside it.
	it('a marked schema does not fall back to the guess', () => {
		const got = translatableFields([f('title', 'text', { localized: true }), f('subtitle', 'text')]);
		expect(got.map((x) => x.name)).toEqual(['title']);
	});

	it('says which of the two answers it gave', () => {
		expect(usesMarkedFields([f('title', 'text', { localized: true })])).toBe(true);
		expect(usesMarkedFields([f('title', 'text')])).toBe(false);
		expect(usesMarkedFields([f('id', 'uid', { system: true, localized: true })])).toBe(false);
	});
});

describe('completenessOf', () => {
	const f = (name: string) =>
		({ name, field_type: 'text', required: false, unique: false, indexed: false }) as SchemaField;

	it('counts what is written', () => {
		const got = completenessOf({ title: 'Bonjour', body: '' }, [f('title'), f('body')]);
		expect(got).toEqual({ done: 1, total: 2, percent: 50, missing: ['body'] });
	});

	// A field holding a space is what a half-finished paste leaves behind, and
	// counting it reports a locale complete that nobody has translated.
	it('does not count whitespace', () => {
		const got = completenessOf({ title: '   ', body: '\n\t' }, [f('title'), f('body')]);
		expect(got.done).toBe(0);
		expect(got.missing).toEqual(['title', 'body']);
	});

	it('treats an absent key as missing', () => {
		expect(completenessOf({}, [f('title')]).missing).toEqual(['title']);
	});

	// There is nothing outstanding, and 0% sends somebody looking for work that
	// does not exist.
	it('nothing to translate is complete, not zero', () => {
		const got = completenessOf({}, []);
		expect(got.percent).toBe(100);
		expect(got.total).toBe(0);
	});

	it('fully written is a hundred', () => {
		const got = completenessOf({ title: 'Bonjour' }, [f('title')]);
		expect(got.percent).toBe(100);
		expect(got.missing).toEqual([]);
	});
});
