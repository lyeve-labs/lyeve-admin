import { describe, expect, it } from 'vitest';
import { ApiError } from '@lyeve-labs/client';
import { recoveryRefusal } from './recovery';

describe('recoveryRefusal', () => {
	it.each([404, 405, 402])('reads %i as a way in this instance does not offer', (status) => {
		expect(recoveryRefusal(new ApiError(status, 'x'), 'Password reset')).toEqual({
			status: 404,
			error: 'Password reset is not enabled on this instance. Ask an administrator to sign you in.',
		});
	});

	it('reports a rate limit as one', () => {
		expect(recoveryRefusal(new ApiError(429, 'x'), 'Email sign-in')?.status).toBe(429);
	});

	it('reports an outage and an unreachable engine as unavailable', () => {
		expect(recoveryRefusal(new ApiError(503, 'x'), 'Email sign-in')?.error).toMatch(/unavailable/);
		expect(recoveryRefusal(new TypeError('fetch failed'), 'Email sign-in')?.status).toBe(503);
	});

	it('leaves a refusal of the input to the caller', () => {
		expect(recoveryRefusal(new ApiError(400, 'invalid'), 'Email sign-in')).toBeNull();
	});
});
