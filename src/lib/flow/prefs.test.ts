import { describe, expect, it } from 'vitest';
import { FOCUS_KEY, readFocus, writeFocus } from './prefs';

function memory(seed: Record<string, string> = {}) {
	const map = new Map(Object.entries(seed));
	return {
		getItem: (k: string) => map.get(k) ?? null,
		setItem: (k: string, v: string) => void map.set(k, v),
		map,
	};
}

const refusing = {
	getItem: () => {
		throw new Error('refused');
	},
	setItem: () => {
		throw new Error('refused');
	},
};

describe('focus mode preference', () => {
	it('defaults off, reads back what was written, and survives a refusing storage', () => {
		const s = memory();
		expect(readFocus(s)).toBe(false);
		writeFocus(s, true);
		expect(s.map.get(FOCUS_KEY)).toBe('1');
		expect(readFocus(s)).toBe(true);
		writeFocus(s, false);
		expect(readFocus(s)).toBe(false);
		expect(readFocus(refusing)).toBe(false);
		expect(() => writeFocus(refusing, true)).not.toThrow();
		expect(readFocus(null)).toBe(false);
	});
});
