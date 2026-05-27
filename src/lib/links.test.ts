import { describe, expect, it } from 'vitest';
import { isExternalHref, linkHref } from './links';

describe('isExternalHref', () => {
	it('treats the engine default license path as in-console', () => {
		expect(isExternalHref('/admin/settings/license?plugin=example')).toBe(false);
	});

	it('treats absolute and protocol-relative URLs as external', () => {
		expect(isExternalHref('https://example.test/enable')).toBe(true);
		expect(isExternalHref('HTTP://example.test/')).toBe(true);
		expect(isExternalHref('//example.test/enable')).toBe(true);
	});

	it('treats a relative path as in-console', () => {
		expect(isExternalHref('settings/license')).toBe(false);
	});
});

describe('linkHref', () => {
	it('keeps a path on this console and an https URL', () => {
		expect(linkHref('/admin/settings/license?plugin=search')).toBe('/admin/settings/license?plugin=search');
		expect(linkHref('https://example.test/enable')).toBe('https://example.test/enable');
	});

	it('drops anything a link could be abused with, and nothing at all', () => {
		expect(linkHref('javascript:alert(1)')).toBeNull();
		expect(linkHref('http://example.test/enable')).toBeNull();
		expect(linkHref('//example.test/enable')).toBeNull();
		expect(linkHref('/elsewhere')).toBeNull();
		expect(linkHref('')).toBeNull();
		expect(linkHref(undefined)).toBeNull();
	});
});
