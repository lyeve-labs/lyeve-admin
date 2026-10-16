import { globSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { entryTone, httpStatusTone, methodTone } from './tones';

describe('methodTone', () => {
	it('paints a read in brand on every page that lists routes', () => {
		expect(methodTone('GET')).toBe('brand');
		expect(methodTone('HEAD')).toBe('brand');
	});

	it('sets each kind of write apart from a read and a delete from both', () => {
		expect(methodTone('POST')).toBe('success');
		expect(methodTone('PUT')).toBe('warn');
		expect(methodTone('PATCH')).toBe('warn');
		expect(methodTone('DELETE')).toBe('danger');
	});

	it('reads a method in any case and leaves an unknown one neutral', () => {
		expect(methodTone('get')).toBe('brand');
		expect(methodTone('OPTIONS')).toBe('neutral');
	});
});

describe('entryTone', () => {
	it('tells a published entry from a draft and from anything else', () => {
		expect(entryTone('published')).toBe('success');
		expect(entryTone('draft')).toBe('warn');
		expect(entryTone('archived')).toBe('neutral');
	});
});

describe('httpStatusTone', () => {
	it('reads each class of response the same on every page', () => {
		expect(httpStatusTone(200)).toBe('success');
		expect(httpStatusTone(204)).toBe('success');
		expect(httpStatusTone(302)).toBe('neutral');
		expect(httpStatusTone(404)).toBe('warn');
		expect(httpStatusTone(503)).toBe('danger');
	});

	// A 0 is a request that got no answer, and a 1xx is not a final response.
	// Neither says the server failed.
	it('leaves a status outside the response classes neutral', () => {
		expect(httpStatusTone(0)).toBe('neutral');
		expect(httpStatusTone(101)).toBe('neutral');
		expect(httpStatusTone(600)).toBe('neutral');
	});
});

// A tone union written out by hand drifts from the kit's when the kit adds
// or renames a tone, so a tone is typed as the kit's StatusTone, or
// AccentTone where a label may be violet.
describe('tone types', () => {
	it('writes no tone union by hand', () => {
		const union = /'(neutral|brand|success|warn|danger|violet)'(\s*\|\s*'(neutral|brand|success|warn|danger|violet)')+/;
		const offenders = globSync('src/**/*.{ts,svelte}')
			.filter((file) => !file.endsWith('.test.ts'))
			.flatMap((file) =>
				readFileSync(file, 'utf8')
					.split('\n')
					.flatMap((line, i) => (union.test(line) ? [`${file}:${i + 1}`] : [])),
			);
		expect(offenders).toEqual([]);
	});
});
