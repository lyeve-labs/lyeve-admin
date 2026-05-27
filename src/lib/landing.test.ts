import { describe, expect, it } from 'vitest';
import { LANDING } from './landing';
import { pagePlugin } from './nav';

describe('LANDING', () => {
	it('is the dashboard', () => {
		expect(LANDING).toBe('/admin');
	});

	it('belongs to no plugin, so every engine serves it', () => {
		expect(pagePlugin(LANDING)).toBeUndefined();
	});
});
