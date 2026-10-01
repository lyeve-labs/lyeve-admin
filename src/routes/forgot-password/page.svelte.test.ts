// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import ForgotPage from './+page.svelte';

afterEach(cleanup);

describe('Forgot password page', () => {
	it('asks for the address to send the reset link to', () => {
		const { container, getByRole } = render(ForgotPage, { props: { form: null } as never });

		expect((container.querySelector('#email') as HTMLInputElement).type).toBe('email');
		expect(getByRole('button', { name: /email me a reset link/i })).toBeTruthy();
	});

	it('keeps the address and states the refusal', () => {
		const { container } = render(ForgotPage, {
			props: { form: { error: 'Enter a valid email address.', email: 'nope' } } as never,
		});

		expect((container.querySelector('#email') as HTMLInputElement).value).toBe('nope');
		expect(container.textContent).toContain('Enter a valid email address.');
	});
});
