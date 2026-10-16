import { describe, it, expect } from 'vitest';
import { ApiError } from '@lyeve-labs/client';

import { seatRefusal } from './admin-seats';

function refusal(body: Record<string, unknown>, status = 402): ApiError {
	return new ApiError(status, String(body.error ?? 'refused'), body);
}

describe('seatRefusal', () => {
	it('answers the refusal at the seat cap with its numbers and its link', () => {
		const err = refusal({ error: 'cap_exceeded', cap: 'admin.seats', limit: 7, current: 7, upgrade_url: 'https://shop.example.com/pricing?utm_campaign=admin.seats' });
		expect(seatRefusal(err)).toEqual({ kind: 'cap', cap: 'admin.seats', limit: 7, current: 7, upgradeUrl: 'https://shop.example.com/pricing?utm_campaign=admin.seats' });
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
