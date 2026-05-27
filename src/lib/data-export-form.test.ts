import { describe, expect, it } from 'vitest';
import { exportConfigFrom } from './data-export-form';

function form(entries: [string, string][]): FormData {
	const f = new FormData();
	for (const [k, v] of entries) f.append(k, v);
	return f;
}

describe('exportConfigFrom', () => {
	it('reads every picked schema and status, and the switches', () => {
		const got = exportConfigFrom(
			form([
				['format', 'ndjson'],
				['schemas', 'article'],
				['schemas', 'page'],
				['statuses', 'published'],
				['statuses', 'bogus'],
				['include_schemas', 'true'],
				['include_media', 'false'],
			]),
		);
		expect(got).toEqual({
			config: {
				format: 'ndjson',
				filter: { schemas: ['article', 'page'], statuses: ['published'] },
				include_schemas: true,
				include_media: false,
			},
		});
	});

	it('sends no schema filter when none is picked, which the plugin reads as every schema', () => {
		const got = exportConfigFrom(form([['format', 'json']]));
		expect('config' in got && got.config.filter).toEqual({});
	});

	it('refuses an unknown format and a template export without its template', () => {
		expect(exportConfigFrom(form([['format', 'xml']]))).toHaveProperty('error');
		expect(exportConfigFrom(form([['format', 'template']]))).toHaveProperty('error');
	});
});
