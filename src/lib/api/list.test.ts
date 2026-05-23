import { describe, it, expect } from 'vitest';
import { totalOf } from './list';

describe('totalOf', () => {
	it('prefers the envelope count over the page length', () => {
		expect(totalOf({ data: [1, 2], limit: 2, offset: 0, total_count: 97 })).toBe(97);
	});

	it('falls back to the array length for a bare array', () => {
		expect(totalOf([1, 2, 3])).toBe(3);
	});

	it('falls back to the data length when the count is absent', () => {
		expect(totalOf({ data: [1, 2] })).toBe(2);
	});

	it('reports zero for an empty or absent result', () => {
		expect(totalOf(null)).toBe(0);
		expect(totalOf(undefined)).toBe(0);
		expect(totalOf({ data: null })).toBe(0);
		expect(totalOf([])).toBe(0);
	});
});
