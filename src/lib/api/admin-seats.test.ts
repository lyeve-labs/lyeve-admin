import { describe, it, expect } from 'vitest';
import { ApiError } from '@lyeve-labs/client';

import { seatRefusal } from './admin-seats';

function refusal(body: Record<string, unknown>, status = 402): ApiError {
	return new ApiError(status, String(body.error ?? 'refused'), body);
}

describe('seatRefusal', () => {
	it('states the refusal numbers for the seat cap', () => {
		const err = refusal({ error: 'cap_exceeded', cap: 'admin.seats', limit: 7, current: 7, upgrade_url: '' });
		expect(seatRefusal(err)).toBe(
			'Every admin seat is taken. 7 of 7 are in use, which is the most this instance allows. Editors and viewers take no seat, so remove the admin role from an account to add another.',
		);
	});

	it('leaves a refusal at another cap to its own handling', () => {
		const err = refusal({ error: 'cap_exceeded', cap: 'example.items', limit: 4, current: 4 });
		expect(seatRefusal(err)).toBeNull();
	});

	it('leaves a capacity refusal that names no cap alone', () => {
		expect(seatRefusal(refusal({ error: 'cap_exceeded', limit: 1, current: 1 }))).toBeNull();
	});

	it('leaves a feature lock and other failures alone', () => {
		expect(seatRefusal(refusal({ error: 'feature_not_licensed', cap: 'admin.seats' }))).toBeNull();
		expect(seatRefusal(refusal({ cap: 'admin.seats' }, 404))).toBeNull();
		expect(seatRefusal(new Error('network'))).toBeNull();
	});
});
