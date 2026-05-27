import { describe, expect, it } from 'vitest';
import { PLUGIN } from './plugin-names';

describe('PLUGIN', () => {
	it('names each plugin the way the engine reports it: unprefixed kebab-case', () => {
		for (const value of Object.values(PLUGIN)) {
			expect(value, `"${value}" carries a namespace prefix`).not.toContain(':');
			expect(value, `"${value}" is not kebab-case`).toMatch(/^[a-z][a-z0-9-]*$/);
		}
	});

	it('names each plugin once', () => {
		const values = Object.values(PLUGIN);
		expect(new Set(values).size).toBe(values.length);
	});

	it('keys each name in camelCase', () => {
		for (const key of Object.keys(PLUGIN)) {
			expect(key).toMatch(/^[a-z][a-zA-Z0-9]*$/);
		}
	});

	it('uses the engine name where it differs from the key', () => {
		expect(PLUGIN.analytics).toBe('apianalytics');
		expect(PLUGIN.deviceFingerprint).toBe('device-fingerprint');
		expect(PLUGIN.piiMask).toBe('pii-mask');
	});
});
