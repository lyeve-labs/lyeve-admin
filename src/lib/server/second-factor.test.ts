import { describe, expect, it } from 'vitest';
import { ApiError } from '@lyeve-labs/client';
import { secondFactorFailure } from './second-factor';

const UNCHECKED = 'The engine did not answer, so the code was not checked. Try again in a moment.';

describe('secondFactorFailure', () => {
	it.each([
		[400, 'a request the engine could not read'],
		[422, 'a code that did not match'],
	])('reads a %i, %s, as an invalid code', (status) => {
		expect(secondFactorFailure(new ApiError(status, 'refused'))).toEqual({ status: 400, error: 'Invalid code.' });
	});

	it('reads a 401, a challenge the engine no longer honors, as an expired sign-in', () => {
		expect(secondFactorFailure(new ApiError(401, 'challenge expired'))).toEqual({
			status: 401,
			error: 'This sign-in expired. Sign in again.',
			expired: true,
		});
	});

	it('reads a 429 as too many attempts, which no other code can fix', () => {
		const failed = secondFactorFailure(new ApiError(429, 'locked out'));
		expect(failed.status).toBe(429);
		expect(failed.error).toMatch(/too many verification attempts/i);
	});

	it.each([
		['a 503', new ApiError(503, 'session store unavailable')],
		['a 500', new ApiError(500, 'internal error')],
		['a 502 from a proxy', new ApiError(502, 'bad gateway')],
		['a refused connection', new TypeError('fetch failed')],
		['a timeout', new DOMException('The operation was aborted due to timeout', 'TimeoutError')],
	])('says the code was not checked after %s', (_case, e) => {
		expect(secondFactorFailure(e)).toEqual({ status: 503, error: UNCHECKED });
	});

	it('never repeats what the engine or the network said', () => {
		const failed = secondFactorFailure(new Error('driver: connection reset by peer'));
		expect(failed.error).not.toContain('driver');
	});
});
