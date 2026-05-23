import { describe, expect, it } from 'vitest';
import { browserOffset, instantFromWallClock } from './wall-clock';

describe('wall clock', () => {
	it('applies the offset the browser posted, not the server zone', () => {
		// A zone nine hours east of UTC reports -540 from getTimezoneOffset.
		expect(instantFromWallClock('2026-09-26T09:30', '-540')?.toISOString()).toBe('2026-09-26T00:30:00.000Z');
		// New York in September is UTC-4.
		expect(instantFromWallClock('2026-09-26T09:30:15', '240')?.toISOString()).toBe('2026-09-26T13:30:15.000Z');
	});

	it('falls back to the server reading when no offset came with it', () => {
		const at = instantFromWallClock('2026-09-26T09:30', '');
		expect(at?.getHours()).toBe(9);
	});

	it('refuses what names no instant and an offset no zone has', () => {
		expect(instantFromWallClock('yesterday', '')).toBeNull();
		expect(instantFromWallClock('2026-09-26T09:30', '5000')?.getHours()).toBe(9);
	});

	it('reads the browser offset from the parts', () => {
		const expected = new Date(2026, 8, 26, 9, 30).getTimezoneOffset();
		expect(browserOffset('2026-09-26T09:30')).toBe(String(expected));
		expect(browserOffset('')).toBe('');
	});
});
