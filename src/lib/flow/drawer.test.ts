import { describe, expect, it, vi } from 'vitest';
import { DRAWER_DEFAULT, DRAWER_HEIGHT_KEY, DRAWER_MIN, clampDrawerHeight, readDrawerHeight, writeDrawerHeight } from './drawer';

function memory(initial: Record<string, string> = {}) {
	const store = { ...initial };
	return {
		store,
		getItem: (k: string) => (k in store ? store[k] : null),
		setItem: (k: string, v: string) => {
			store[k] = v;
		},
	};
}

describe('drawer height', () => {
	it('clamps between the minimum and what leaves the canvas room', () => {
		expect(clampDrawerHeight(10, 800)).toBe(DRAWER_MIN);
		expect(clampDrawerHeight(700, 800)).toBe(560);
		expect(clampDrawerHeight(300, 800)).toBe(300);
	});

	it('reads the remembered height, or the default when nothing or junk is stored', () => {
		expect(readDrawerHeight(memory({ [DRAWER_HEIGHT_KEY]: '320' }), 800)).toBe(320);
		expect(readDrawerHeight(memory(), 800)).toBe(DRAWER_DEFAULT);
		expect(readDrawerHeight(memory({ [DRAWER_HEIGHT_KEY]: 'tall' }), 800)).toBe(DRAWER_DEFAULT);
		expect(readDrawerHeight(null, 800)).toBe(DRAWER_DEFAULT);
	});

	it('survives storage that throws', () => {
		const broken = {
			getItem: vi.fn(() => {
				throw new Error('denied');
			}),
			setItem: vi.fn(() => {
				throw new Error('denied');
			}),
		};
		expect(readDrawerHeight(broken, 800)).toBe(DRAWER_DEFAULT);
		expect(() => writeDrawerHeight(broken, 300)).not.toThrow();
	});

	it('writes a rounded height', () => {
		const m = memory();
		writeDrawerHeight(m, 301.6);
		expect(m.store[DRAWER_HEIGHT_KEY]).toBe('302');
	});
});
