import { describe, expect, it } from 'vitest';

import { LOCALE_CODE, parsePreferences } from './preferences';

const form = (fields: Record<string, string>) => {
	const fd = new FormData();
	for (const [k, v] of Object.entries(fields)) fd.set(k, v);
	return fd;
};

describe('LOCALE_CODE', () => {
	it('accepts a language, a region and a script', () => {
		for (const code of ['en', 'fr-CA', 'zh-Hant-TW', 'pt-BR']) expect(LOCALE_CODE.test(code)).toBe(true);
	});

	it('refuses words, upper-case languages and empty subtags', () => {
		for (const code of ['French', 'EN', 'fr-', '', 'e']) expect(LOCALE_CODE.test(code)).toBe(false);
	});
});

describe('parsePreferences', () => {
	it('keeps the default locale in the enabled list', () => {
		expect(parsePreferences(form({ default_locale: 'en', enabled_locales: '["fr"]', fallback_chain: '["fr"]' }))).toEqual({
			prefs: { default_locale: 'en', enabled_locales: ['en', 'fr'], fallback_chain: ['fr'] },
		});
	});

	it('drops duplicates, blanks and a list that is not JSON', () => {
		expect(parsePreferences(form({ default_locale: 'en', enabled_locales: '["fr"," ","fr"]', fallback_chain: 'nope' }))).toEqual({
			prefs: { default_locale: 'en', enabled_locales: ['en', 'fr'], fallback_chain: [] },
		});
	});

	it('refuses an empty default, a malformed code and a chain naming an unknown locale', () => {
		expect(parsePreferences(form({ default_locale: '' }))).toMatchObject({ error: /default locale/ });
		expect(parsePreferences(form({ default_locale: 'en', enabled_locales: '["French"]' }))).toMatchObject({
			error: /"French" is not a locale code/,
		});
		expect(parsePreferences(form({ default_locale: 'en', enabled_locales: '["fr"]', fallback_chain: '["de"]' }))).toMatchObject({
			error: /names de/,
		});
	});
});
