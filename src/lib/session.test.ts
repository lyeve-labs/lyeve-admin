import { describe, expect, it } from 'vitest';
import { signInAgainHref } from './session';

describe('signInAgainHref', () => {
	it('names the sign-in page that says the session ended, and the page to come back to', () => {
		expect(signInAgainHref(new URL('http://x/admin/flows/f1?tab=runs'))).toBe('/login?ended=1&next=%2Fadmin%2Fflows%2Ff1%3Ftab%3Druns');
	});
});
