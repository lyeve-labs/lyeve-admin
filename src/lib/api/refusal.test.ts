import { describe, expect, it } from 'vitest';
import { ApiError } from '@lyeve-labs/client';

import { capNoun, featureName, formRefusal, refusalOf, refusalText, refusalTitle } from './refusal';

function refused(body: Record<string, unknown>, status = 402): ApiError {
	return new ApiError(status, String(body.error ?? 'refused'), body);
}

describe('refusalOf', () => {
	it('reads a cap refusal with the numbers the engine sent', () => {
		const r = refusalOf(refused({ error: 'cap_exceeded', cap: 'example.items', limit: 4, current: 4, upgrade_url: '' }));
		expect(r).toEqual({ kind: 'cap', cap: 'example.items', limit: 4, current: 4, upgradeUrl: '' });
	});

	it('reads a feature refusal by the capability name a license carries', () => {
		const r = refusalOf(refused({ error: 'payment_required', plugin: 'example', feature: 'feature:example_feature', upgrade_url: '' }));
		expect(r).toEqual({ kind: 'feature', feature: 'example-feature', plugin: 'example', upgradeUrl: '' });
	});

	it('leaves every other failure alone', () => {
		expect(refusalOf(refused({ error: 'not found' }, 404))).toBeNull();
		expect(refusalOf(new Error('network'))).toBeNull();
		expect(refusalOf(undefined)).toBeNull();
	});

	it('keeps a number the engine did not send as unknown', () => {
		const r = refusalOf(refused({ error: 'cap_exceeded', cap: 'example.items', limit: 'four' }));
		expect(r).toMatchObject({ limit: null, current: null });
	});
});

describe('refusalText', () => {
	it('says the count against the ceiling in the words of the cap', () => {
		expect(refusalText({ kind: 'cap', cap: 'example.items', limit: 4, current: 4, upgradeUrl: '' })).toBe(
			'4 of 4 items are in use, which is the most this instance allows. Remove one, or change the license to allow more.',
		);
	});

	it('says only the ceiling when the count is missing', () => {
		expect(refusalText({ kind: 'cap', cap: 'example.widget_slots', limit: 9, current: null, upgradeUrl: '' })).toContain(
			'This instance allows at most 9 widget slots.',
		);
	});

	it('states the seat count and how to free a seat', () => {
		expect(refusalText({ kind: 'cap', cap: 'admin.seats', limit: 7, current: 7, upgradeUrl: '' })).toBe(
			'Every admin seat is taken. 7 of 7 are in use, which is the most this instance allows. Editors and viewers take no seat, so remove the admin role from an account to add another.',
		);
	});

	it('names the capability a feature refusal needs', () => {
		const r = { kind: 'feature', feature: 'example-feature', plugin: 'example', upgradeUrl: '' } as const;
		expect(refusalText(r)).toBe('The license on this instance does not include example-feature. Nothing was changed.');
		expect(refusalTitle(r)).toBe('This needs example-feature');
	});

	it('words a feature refusal that names no capability', () => {
		const r = { kind: 'feature', feature: '', plugin: '', upgradeUrl: '' } as const;
		expect(refusalText(r)).toBe('This needs a capability this license does not include. Nothing was changed.');
		expect(refusalTitle(r)).toBe('This is not enabled on this instance');
	});
});

describe('helpers', () => {
	it('turns a feature code into the capability name', () => {
		expect(featureName('feature:example_feature')).toBe('example-feature');
		expect(featureName('feature-b')).toBe('feature-b');
	});

	it('names a cap by its last segment', () => {
		expect(capNoun('example.items')).toBe('items');
		expect(capNoun('gadgets.spare-parts')).toBe('spare parts');
		expect(capNoun('widgets')).toBe('widgets');
		expect(capNoun('admin.seats')).toBe('admin seats');
	});

	it('falls back to a neutral noun for a cap with no usable segment', () => {
		expect(capNoun('')).toBe('items');
		expect(capNoun('example.')).toBe('items');
		expect(capNoun('example._')).toBe('items');
	});

	it('reads only a refusal of its own shape from an action result', () => {
		const cap = { kind: 'cap', cap: 'example.items', limit: 4, current: 4, upgradeUrl: '' };
		expect(formRefusal({ error: 'x', refused: cap })).toEqual(cap);
		expect(formRefusal({ error: 'x', refusal: { nodeIds: [] } })).toBeNull();
		expect(formRefusal(null)).toBeNull();
	});
});
