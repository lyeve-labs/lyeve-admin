// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import MagicLinkPage from './+page.svelte';

afterEach(cleanup);

describe('Magic link request page', () => {
	it('asks for the address to send the link to', () => {
		const { container, getByRole } = render(MagicLinkPage, { props: { form: null } as never });

		expect((container.querySelector('#email') as HTMLInputElement).type).toBe('email');
		expect(getByRole('button', { name: /email me a link/i })).toBeTruthy();
	});

	it('confirms without saying whether the address has an account', () => {
		const { container } = render(MagicLinkPage, { props: { form: { sent: true, email: 'a@b.co' } } as never });

		expect(container.textContent).toContain('If an account exists for a@b.co');
		expect(container.querySelector('#email')).toBeNull();
	});
});
