// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import VerifyPage from './+page.svelte';

afterEach(cleanup);

const props = (token: string, form: unknown = null) => ({ form, data: { token } }) as never;

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
