import { describe, expect, it } from 'vitest';
import { asksOrganization } from './sign-in-organization';

describe('asksOrganization', () => {
	it('stays off when the console names nothing', () => {
		expect(asksOrganization({})).toBe(false);
		expect(asksOrganization({ SIGN_IN_ORGANIZATION: '' })).toBe(false);
	});

	it.each(['true', 'TRUE', '1', ' true '])('turns on for %j', (value) => {
		expect(asksOrganization({ SIGN_IN_ORGANIZATION: value })).toBe(true);
	});

	it.each(['false', '0', 'no', 'yes', 'on'])('stays off for %j', (value) => {
		expect(asksOrganization({ SIGN_IN_ORGANIZATION: value })).toBe(false);
	});
});
