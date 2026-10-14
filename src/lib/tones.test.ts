import { describe, expect, it } from 'vitest';
import { entryTone, methodTone } from './tones';

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
