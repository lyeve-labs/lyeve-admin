import { describe, expect, it } from 'vitest';
import { ApiError } from '@lyeve-labs/client';
import { fullText, gateOf } from './gate';

const FAILED = 'The list could not be read. This is not a report that it is empty.';

describe('gateOf', () => {
	it('calls a 404 absent', () => {
		expect(gateOf(new ApiError(404, 'not found'), FAILED)).toEqual({ state: 'absent' });
	});

	it('calls a 402 not enabled, with the link the refusal names', () => {
		expect(gateOf(new ApiError(402, 'payment_required'), FAILED)).toEqual({ state: 'locked', upgradeUrl: '' });
		const named = new ApiError(402, 'payment_required', { error: 'payment_required', upgrade_url: '/admin/settings/license' });
		expect(gateOf(named, FAILED)).toEqual({ state: 'locked', upgradeUrl: '/admin/settings/license' });
	});

	it('reads a capacity refusal as a ceiling with its numbers, never as a missing feature', () => {
		const full = new ApiError(402, 'cap_exceeded', { error: 'cap_exceeded', cap: 'x', limit: 7, current: 7, upgrade_url: '' });
		expect(gateOf(full, FAILED)).toEqual({ state: 'full', limit: 7, current: 7, upgradeUrl: '' });
		const bare = new ApiError(402, 'cap_exceeded', { error: 'cap_exceeded' });
		expect(gateOf(bare, FAILED)).toEqual({ state: 'full', limit: null, current: null, upgradeUrl: '' });
	});

	it('reports anything else as a failed read in the page\'s own words', () => {
		expect(gateOf(new ApiError(503, 'unavailable'), FAILED)).toEqual({ state: 'error', message: FAILED });
		expect(gateOf(new ApiError(500, 'boom'), FAILED)).toEqual({ state: 'error', message: FAILED });
		expect(gateOf(new Error('network'), FAILED)).toEqual({ state: 'error', message: FAILED });
	});
});

describe('fullText', () => {
	it('states the count against the ceiling when both are known', () => {
		expect(fullText({ state: 'full', limit: 7, current: 7, upgradeUrl: '' })).toBe(
			'7 of 7 are in use, which is the most this instance allows.',
		);
	});

	it('states only what the refusal carried', () => {
		expect(fullText({ state: 'full', limit: 5, current: null, upgradeUrl: '' })).toBe('This instance allows at most 5.');
		expect(fullText({ state: 'full', limit: null, current: null, upgradeUrl: '' })).toBe('This instance allows no more.');
	});
});
