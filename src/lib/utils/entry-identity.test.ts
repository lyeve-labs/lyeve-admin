import { describe, expect, it } from 'vitest';
import type { FieldType, SchemaField } from '@lyeve-labs/client';
import { entryLabel, entryTitle, humanizeFieldName, shortId } from './entry-identity';

const field = (name: string, field_type: FieldType = 'text'): SchemaField => ({
	name,
	field_type,
	required: false,
	unique: false,
	indexed: false,
});

describe('entryTitle', () => {
	it('prefers the entry title', () => {
		const resolved = entryTitle(
			{ id: 'a', title: 'Release notes', slug: 'release-notes', data: { name: 'Other' } },
			[field('name')],
		);
		expect(resolved).toEqual({ label: 'Release notes', source: 'title' });
	});

	it('reads a title the load folded into data', () => {
		const resolved = entryTitle({ id: 'a', data: { title: 'Release notes' } });
		expect(resolved).toEqual({ label: 'Release notes', source: 'title' });
	});

	it('falls back to the slug when the title is blank', () => {
		const resolved = entryTitle({ id: 'a', title: '   ', slug: 'release-notes' });
		expect(resolved).toEqual({ label: 'release-notes', source: 'slug' });
	});

	it('names the field a fallback label came from', () => {
		const resolved = entryTitle({ id: 'a', data: { subject: 'Invoice 41' } }, [field('subject')]);
		expect(resolved).toEqual({ label: 'Invoice 41', source: 'field', field: 'subject' });
	});

	it('takes the conventional name fields in schema order', () => {
		// Not in the order this module lists them: a schema that declares both
		// shows whichever its author put first.
		const resolved = entryTitle({ id: 'a', data: { heading: 'H', subject: 'S' } }, [
			field('subject'),
			field('heading'),
		]);
		expect(resolved.label).toBe('S');
	});

	it('ignores a conventional name the schema does not declare', () => {
		const resolved = entryTitle({ id: 'a', data: { subject: 'Invoice 41' } }, [field('body')]);
		expect(resolved.source).toBe('none');
	});

	it('ignores a name field holding something that is not text', () => {
		const resolved = entryTitle({ id: 'a', data: { name: 42, label: 'Tier one' } }, [
			field('name', 'number'),
			field('label'),
		]);
		expect(resolved).toEqual({ label: 'Tier one', source: 'field', field: 'label' });
	});

	it('reports nothing rather than an empty label', () => {
		const resolved = entryTitle({ id: 'a', data: { body: 'text' } }, [field('body')]);
		expect(resolved).toEqual({ label: '', source: 'none' });
	});

	it('trims the label it returns', () => {
		expect(entryTitle({ id: 'a', title: '  Spaced  ' }).label).toBe('Spaced');
	});
});

describe('entryLabel', () => {
	it('tries every conventional name when there is no schema to consult', () => {
		expect(entryLabel({ id: 'a', data: { heading: 'Chapter one' } })).toBe('Chapter one');
	});

	it('falls back to the short id so an option is never blank', () => {
		expect(entryLabel({ id: '3f2b1c9a-7d4e', data: { body: 'text' } })).toBe('3f2b1c9a');
	});
});

describe('shortId', () => {
	it('takes the first eight characters', () => {
		expect(shortId('3f2b1c9a-7d4e-4a11-9c3d-0b1e2f3a4b5c')).toBe('3f2b1c9a');
	});

	it('leaves an id shorter than eight characters alone', () => {
		expect(shortId('abc')).toBe('abc');
	});
});

describe('humanizeFieldName', () => {
	it('turns a screaming snake case column into a header', () => {
		expect(humanizeFieldName('ORDER_TOTAL_V2')).toBe('Order Total V2');
	});

	it('splits camel case', () => {
		expect(humanizeFieldName('publishedAt')).toBe('Published At');
	});

	it('splits on hyphens as well as underscores', () => {
		expect(humanizeFieldName('cover-image_url')).toBe('Cover Image Url');
	});

	it('collapses repeated separators', () => {
		expect(humanizeFieldName('__body__')).toBe('Body');
	});

	it('leaves an empty name empty', () => {
		expect(humanizeFieldName('')).toBe('');
	});
});
