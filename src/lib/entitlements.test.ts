import { describe, it, expect } from 'vitest';
import { hasFeature, hasLicenseModule, NO_ENTITLEMENTS } from './entitlements';
import type { Entitlements } from '$lib/entitlements';

const example: Entitlements = {
	plan: 'example',
	state: 'active',
	features: ['search', 'audit'],
	tenant_quota: 0,
};

describe('hasFeature', () => {
	it('is true when the feature is present', () => {
		expect(hasFeature(example, 'search')).toBe(true);
	});

	it('is false when the feature is absent', () => {
		expect(hasFeature(example, 'localization')).toBe(false);
	});

	it('is false for a feature withheld from the tenant', () => {
		const withheld = { ...example, withheld: ['search'] };
		expect(hasFeature(withheld, 'search')).toBe(false);
		expect(hasFeature(withheld, 'flow')).toBe(example.features.includes('flow'));
	});

	it('fails closed for null/undefined entitlements', () => {
		expect(hasFeature(null, 'search')).toBe(false);
		expect(hasFeature(undefined, 'search')).toBe(false);
	});
});

describe('hasLicenseModule', () => {
	it('is true only when the engine says the build links one', () => {
		expect(hasLicenseModule({ ...example, license_module: true })).toBe(true);
		expect(hasLicenseModule({ ...example, license_module: false })).toBe(false);
	});

	it('reads an engine that does not say, and entitlements nobody could read, as none', () => {
		expect(hasLicenseModule(example)).toBe(false);
		expect(hasLicenseModule(NO_ENTITLEMENTS)).toBe(false);
		expect(hasLicenseModule(null)).toBe(false);
	});
});

describe('constants', () => {
	it('NO_ENTITLEMENTS fails closed with no plan, no state and no features', () => {
		expect(NO_ENTITLEMENTS.plan).toBe('');
		expect(NO_ENTITLEMENTS.state).toBe('');
		expect(NO_ENTITLEMENTS.features).toEqual([]);
		expect(NO_ENTITLEMENTS.tenant_quota).toBe(0);
	});
});
