import { describe, expect, it } from 'vitest';
import { isInlineDataSchema, previewCount } from './inline';
import { fixtureCatalog } from './fixtures';

const inline = fixtureCatalog.find((s) => s.type === 'data.inline')!;
const query = fixtureCatalog.find((s) => s.type === 'content.query')!;

describe('isInlineDataSchema', () => {
	it('recognizes the format enum, the format-driven code field and the grid', () => {
		expect(isInlineDataSchema(inline.config_schema)).toBe(true);
		expect(isInlineDataSchema(query.config_schema)).toBe(false);
	});

	it('needs the code field to follow the format, not any code field', () => {
		const other = JSON.parse(JSON.stringify(inline.config_schema));
		other.properties.content['x-language'] = 'sql';
		expect(isInlineDataSchema(other)).toBe(false);
	});
});

describe('previewCount', () => {
	it('counts a JSON list, treats an object as one row and cannot count broken JSON', () => {
		expect(previewCount('json', '[{"a":1},{"a":2}]')).toBe(2);
		expect(previewCount('json', '{"a":1}')).toBe(1);
		expect(previewCount('json', '')).toBe(0);
		expect(previewCount('json', '[1,')).toBeNull();
	});

	it('counts CSV lines less the header, unless there is none', () => {
		expect(previewCount('csv', 'id,name\n1,a\n2,b\n')).toBe(2);
		expect(previewCount('csv', 'id,name\n1,a\n2,b\n', false)).toBe(3);
		expect(previewCount('csv', '')).toBe(0);
	});

	it('counts top-level YAML items and calls a mapping one row', () => {
		expect(previewCount('yaml', '- id: 1\n  name: a\n- id: 2\n')).toBe(2);
		expect(previewCount('yaml', 'id: 1\nname: a\n')).toBe(1);
	});

	it('gives up on a template, which only the run can render', () => {
		expect(previewCount('json', '{{ trigger.body }}')).toBeNull();
		expect(previewCount('csv', '{{ vars.csv }}')).toBeNull();
		expect(previewCount('text', '{{ vars.greeting }}')).toBe(1);
	});
});
