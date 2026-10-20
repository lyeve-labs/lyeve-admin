// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import VerifyPage from './+page.svelte';

afterEach(cleanup);

const props = (token: string, form: unknown = null) => ({ form, data: { token } }) as never;

// A backup code is 16 hexadecimal characters.
const BACKUP_CODE = 'a1b2c3d4e5f60718';

/** Whether a field lets a whole backup code be typed into it. */
function fitsBackupCode(field: Element | null): boolean {
	const cap = field?.getAttribute('maxlength');
	return field !== null && (cap === null || Number(cap) >= BACKUP_CODE.length);
}

describe('Magic link verify page', () => {
	it('waits for a click before redeeming the token', () => {
		const { container, getByRole } = render(VerifyPage, { props: props('abc') });

		const formEl = container.querySelector('form') as HTMLFormElement;
		expect(formEl.getAttribute('action')).toBe('?/verify');
		expect((container.querySelector('input[name="token"]') as HTMLInputElement).value).toBe('abc');
		expect(getByRole('button', { name: /continue/i })).toBeTruthy();
	});

	it('asks for the second factor when the account has one', () => {
		const { container } = render(VerifyPage, {
			props: props('abc', { mfa_required: true, challenge_token: 'ch' }),
		});

		expect(container.querySelector('h1')?.textContent?.trim()).toBe('Two-factor verification');
		expect((container.querySelector('input[name="challenge_token"]') as HTMLInputElement).value).toBe('ch');
		expect(container.querySelector('form')?.getAttribute('action')).toBe('?/mfa');
		// The field also takes a backup code, which is hexadecimal, so it must
		// not bring up a number pad on a phone.
		expect(container.querySelector('input[name="code"]')?.getAttribute('inputmode')).toBeNull();
		expect(fitsBackupCode(container.querySelector('input[name="code"]'))).toBe(true);
	});

	it('offers a new link when the email link carried no token', () => {
		const { getByRole, container } = render(VerifyPage, { props: props('') });

		expect(container.querySelector('form')).toBeNull();
		expect(getByRole('link', { name: /request a new link/i }).getAttribute('href')).toBe('/login/magic-link');
	});

	it('states why a link was refused', () => {
		const { container } = render(VerifyPage, {
			props: props('abc', { error: 'This sign-in link is invalid or has expired. Request a new one.' }),
		});

		expect(container.textContent).toContain('invalid or has expired');
	});
});
