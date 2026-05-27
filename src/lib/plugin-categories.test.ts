import { describe, expect, it } from 'vitest';
import { CATEGORY_LABEL, CATEGORY_ORDER, OTHER_CATEGORY, PLUGIN_CATEGORIES, categoryOf } from './plugin-categories';

describe('plugin categories', () => {
	it('files every category of the set under itself', () => {
		for (const c of PLUGIN_CATEGORIES) expect(categoryOf(c)).toBe(c);
	});

	it('files a missing or unknown category under Other', () => {
		expect(categoryOf(undefined)).toBe(OTHER_CATEGORY);
		expect(categoryOf(null)).toBe(OTHER_CATEGORY);
		expect(categoryOf('')).toBe(OTHER_CATEGORY);
		expect(categoryOf('Content')).toBe(OTHER_CATEGORY);
		expect(categoryOf('something-new')).toBe(OTHER_CATEGORY);
	});

	it('lists Other after every category of the set, each once', () => {
		expect(CATEGORY_ORDER.at(-1)).toBe(OTHER_CATEGORY);
		expect(new Set(CATEGORY_ORDER).size).toBe(CATEGORY_ORDER.length);
		expect(CATEGORY_ORDER.slice(0, -1)).toEqual([...PLUGIN_CATEGORIES]);
	});

	it('has words for every group', () => {
		for (const c of CATEGORY_ORDER) expect(CATEGORY_LABEL[c]).toMatch(/^[A-Z]/);
	});
});
