// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import ResetPage from './+page.svelte';

afterEach(cleanup);

const props = (token: string, form: unknown = null) => ({ form, data: { token, minLength: 12 } }) as never;

describe('Reset password page', () => {
	it('asks for the new password twice and posts the token with it', () => {
		const { container } = render(ResetPage, { props: props('t1') });

		const password = container.querySelector('#password') as HTMLInputElement;
		expect(password.type).toBe('password');
		expect(password.getAttribute('autocomplete')).toBe('new-password');
		expect(container.querySelector('#confirm')).not.toBeNull();
		expect((container.querySelector('input[name="token"]') as HTMLInputElement).value).toBe('t1');
		expect(container.textContent).toContain('At least 12 characters.');
	});

	it('sends the visitor to sign in once the password is changed', () => {
		const { getByRole, container } = render(ResetPage, { props: props('t1', { done: true }) });

		expect(container.querySelector('h1')?.textContent?.trim()).toBe('Password changed');
		expect(getByRole('link', { name: /sign in/i }).getAttribute('href')).toBe('/login');
	});

	it('offers a new link for an expired one instead of the form', () => {
		const { getByRole, container } = render(ResetPage, {
			props: props('t1', { error: 'This reset link is invalid or has expired. Request a new one.', expired: true }),
		});

		expect(container.querySelector('#password')).toBeNull();
		expect(getByRole('link', { name: /request a new link/i }).getAttribute('href')).toBe('/forgot-password');
	});

	it('offers a new link when the email link carried no token', () => {
		const { container } = render(ResetPage, { props: props('') });

		expect(container.querySelector('#password')).toBeNull();
		expect(container.textContent).toContain('incomplete');
	});
});
