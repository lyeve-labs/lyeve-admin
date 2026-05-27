import { describe, expect, it } from 'vitest';
import { licenseStateLabel, licenseTone, unlicensed } from './license-state';

describe('licenseStateLabel', () => {
	it('says each state every module reports in words', () => {
		expect(licenseStateLabel('active')).toBe('Active');
		expect(licenseStateLabel('grace')).toBe('Grace period');
		expect(licenseStateLabel('expired')).toBe('Expired');
	});

	it('reads the absence of a license as no license, whatever the engine calls it', () => {
		for (const state of ['free', 'none', '', null, undefined]) {
			expect(licenseStateLabel(state), String(state)).toBe('No license');
		}
	});

	it('shows a state it has no words for as it arrived', () => {
		expect(licenseStateLabel('suspended')).toBe('suspended');
	});
});

describe('unlicensed', () => {
	it('is true only when no license is in force', () => {
		expect(unlicensed('free')).toBe(true);
		expect(unlicensed('none')).toBe(true);
		expect(unlicensed(undefined)).toBe(true);
		for (const state of ['active', 'grace', 'expired', 'suspended']) {
			expect(unlicensed(state), state).toBe(false);
		}
	});
});

describe('licenseTone', () => {
	it('warns in a grace period, alarms when expired, and stays neutral otherwise', () => {
		expect(licenseTone('active')).toBe('success');
		expect(licenseTone('grace')).toBe('warn');
		expect(licenseTone('expired')).toBe('danger');
		expect(licenseTone('free')).toBe('neutral');
		expect(licenseTone('suspended')).toBe('neutral');
	});
});
