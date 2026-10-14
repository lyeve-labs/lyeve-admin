import { describe, expect, it } from 'vitest';
import type { Schema, SchemaField } from '@lyeve-labs/client';
import { addField, addRelation, dropInertFlags, fieldLabel, inertFlags, isTimestamp, relationFieldName, removeField } from './schema-fields';

function field(over: Partial<SchemaField>): SchemaField {
	return { id: 'f', name: 'x', field_type: 'text', required: false, unique: false, indexed: false, ...over } as SchemaField;
}

function schema(fields: SchemaField[] = []): Schema {
	return { name: 'post', display_name: 'Post', fields };
}

describe('schema field helpers', () => {
	it('names an unnamed field for a control label', () => {
		expect(fieldLabel(field({ name: '' }))).toBe('new field');
		expect(fieldLabel(field({ name: 'title' }))).toBe('title');
	});

	it('treats only created_at and updated_at as timestamp columns', () => {
		expect(isTimestamp(field({ name: 'created_at' }))).toBe(true);
		expect(isTimestamp(field({ name: 'updated_at' }))).toBe(true);
		expect(isTimestamp(field({ name: 'deleted_at' }))).toBe(false);
	});

	it('appends an empty text field with its own id', () => {
		const s = schema([field({ id: 'a' })]);
		addField(s);
		expect(s.fields).toHaveLength(2);
		expect(s.fields[1]).toMatchObject({ name: '', field_type: 'text', required: false, unique: false, indexed: false });
		expect(s.fields[1].id).toBeTruthy();
		expect(s.fields[1].id).not.toBe('a');
	});

	it('adds a relation already typed belongs_to and named after its target', () => {
		const s = schema();
		addRelation(s, 'Author');
		expect(s.fields[0]).toMatchObject({ name: 'author', field_type: 'relation', relation_type: 'belongs_to', relation_to: 'Author' });
		addRelation(s);
		expect(s.fields[1]).toMatchObject({ name: '', field_type: 'relation', relation_type: 'belongs_to' });
		expect(s.fields[1].relation_to).toBeUndefined();
	});

	it('names a relation to its own schema parent, and numbers a taken name', () => {
		const s = schema([field({ name: 'parent' }), field({ name: 'parent_2' }), field({ name: 'author' })]);
		expect(relationFieldName(s, 'post')).toBe('parent_3');
		expect(relationFieldName(s, 'author')).toBe('author_2');
		expect(relationFieldName(s, 'tag')).toBe('tag');
	});

	it('removes a user field and never a system one', () => {
		const s = schema([field({ id: 'sys', name: 'id', system: true }), field({ id: 'u', name: 'title' })]);
		removeField(s, 'sys');
		removeField(s, 'u');
		removeField(s, 'missing');
		expect(s.fields.map((f) => f.id)).toEqual(['sys']);
	});

	it('says why Req and Idx do nothing on each relation kind and on json', () => {
		expect(inertFlags(field({ field_type: 'text' }))).toEqual({ indexed: null, required: null });
		expect(inertFlags(field({ field_type: 'json' }))).toEqual({ indexed: 'A json field cannot be indexed.', required: null });
		expect(inertFlags(field({ field_type: 'relation', relation_type: 'belongs_to' }))).toEqual({ indexed: 'Indexed by its foreign key already.', required: null });
		const many = inertFlags(field({ field_type: 'relation', relation_type: 'has_many' }));
		expect(many.indexed).toBe('No column here to index.');
		expect(many.required).toMatch(/^Nothing here to require\. The key lives in /);
	});

	it('clears the flags that would do nothing', () => {
		const json = field({ field_type: 'json', indexed: true, unique: true, required: true });
		dropInertFlags(json);
		expect(json).toMatchObject({ indexed: false, unique: false, required: true });
		const many = field({ field_type: 'relation', relation_type: 'has_many', indexed: true, required: true });
		dropInertFlags(many);
		expect(many).toMatchObject({ indexed: false, required: false });
	});
});
