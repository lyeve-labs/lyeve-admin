import { describe, expect, it } from 'vitest';
import { narrows } from './narrow';

describe('narrows', () => {
	it('keeps every row for an empty or blank needle', () => {
		expect(narrows('', 'acme')).toBe(true);
		expect(narrows('   ', 'acme')).toBe(true);
	});

	it('matches any field, ignoring case and surrounding space', () => {
		expect(narrows(' ACME ', 'other', 'Acme Corp')).toBe(true);
		expect(narrows('acme', 'other', null, undefined)).toBe(false);
	});
});
