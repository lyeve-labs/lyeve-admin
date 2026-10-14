import { describe, expect, it } from 'vitest';
import { parseCost } from './assist';

describe('parseCost', () => {
	it('reads the decimal string the AI plugin sends', () => {
		expect(parseCost('0.001200')).toBe(0.0012);
		expect(parseCost('0')).toBe(0);
	});

	it('answers null for a cost that does not parse, so it never reads as free', () => {
		for (const cost of ['', ' ', 'n/a', '-1', '1e3', 'NaN', null, undefined, 0.0031, Number.NaN, -1]) {
			expect(parseCost(cost)).toBeNull();
		}
	});
});
