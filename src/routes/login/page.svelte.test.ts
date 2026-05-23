// @vitest-environment jsdom
import { render, cleanup } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import LoginPage from './+page.svelte';

afterEach(cleanup);

// The sign-in buttons for configured providers, without the recovery links
// every form carries.
const providerLinks = (links: HTMLElement[]) =>
	links.filter((a) => a.getAttribute('href')?.startsWith('/api/admin/auth/'));

const props = (extra: Record<string, unknown> = {}) =>
	({ form: null, data: { oauthProviders: [], samlProviders: [] }, ...extra }) as never;

describe('Login page', () => {
	it('asks the browser for the saved password for this account', () => {
		const { container } = render(LoginPage, { props: props() });

		const password = container.querySelector('#password') as HTMLInputElement;
		expect(password.type).toBe('password');
		expect(password.getAttribute('autocomplete')).toBe('current-password');
		expect(password.name).toBe('password');
	});

	// A bare input leaves no way to check a typed password but to clear it and
	// start again.
	it('offers a reveal toggle that does not submit the form', () => {
		const { getByRole } = render(LoginPage, { props: props() });

		const toggle = getByRole('button', { name: /show password/i });
		expect(toggle.getAttribute('type')).toBe('button');
	});

	it('states why a sign-in was refused', () => {
		const { container } = render(LoginPage, {
			props: props({ form: { error: 'Too many attempts. Please try again in a moment.' } }),
		});

		expect(container.textContent).toContain('Too many attempts. Please try again in a moment.');
		expect(container.querySelector('#password')).not.toBeNull();
	});

	it('posts the challenge token back on the second factor step', () => {
		const { container } = render(LoginPage, {
			props: props({ form: { mfa_required: true, challenge_token: 'tok-1' } }),
		});

		const hidden = container.querySelector('input[name="challenge_token"]') as HTMLInputElement;
		expect(hidden.value).toBe('tok-1');
		expect(container.querySelector('h1')?.textContent?.trim()).toBe('Two-factor verification');
		expect(container.querySelector('#password')).toBeNull();
	});

	// A glyph read as an arrow by a sighted reader is read as "left arrow" or
	// skipped entirely by a screen reader, so the icon carries no text.
	it('offers a way back from the second factor step with no glyph standing in for an icon', () => {
		const { getByRole, container } = render(LoginPage, {
			props: props({ form: { mfa_required: true, challenge_token: 'tok-1' } }),
		});

		const back = getByRole('link', { name: /back to sign in/i });
		expect(back.getAttribute('href')).toBe('/login');
		expect(back.querySelector('svg')).toBeTruthy();
		// Arrows, check marks, crosses and bullets, by code point rather than by
		// glyph, so the guard does not carry the thing it forbids.
		expect(container.textContent).not.toMatch(/[\u2190-\u21ff\u2713\u2717\u2022]/);
	});

	it('offers no provider choices when the engine reports none', () => {
		const { queryByText } = render(LoginPage, { props: props() });

		expect(queryByText(/or continue with/i)).toBeNull();
	});

	// An <a> wrapped around a Button nests one interactive element in another.
	// Button renders the anchor itself.
	it('renders each provider as a single anchor', () => {
		const { getAllByRole } = render(LoginPage, {
			props: props({ data: { oauthProviders: ['github', 'azure_ad'], samlProviders: [] } }),
		});

		const links = providerLinks(getAllByRole('link'));
		expect(links.map((a) => a.getAttribute('href'))).toEqual([
			'/api/admin/auth/oauth/github',
			'/api/admin/auth/oauth/azure_ad',
		]);
		expect(links[1].textContent?.trim()).toBe('Sign in with azure ad');
		for (const link of links) {
			expect(link.querySelector('button')).toBeNull();
		}
	});

	// Each configured SAML provider gets a sign-in button, as each OAuth one
	// does.
	it('offers a button for every configured saml provider', () => {
		const { getAllByRole } = render(LoginPage, {
			props: props({ data: { oauthProviders: [], samlProviders: ['Azure AD', 'Okta'] } }),
		});

		const links = providerLinks(getAllByRole('link'));
		expect(links.map((a) => a.getAttribute('href'))).toEqual([
			'/api/admin/auth/saml/Azure%20AD',
			'/api/admin/auth/saml/Okta',
		]);
		// The name is whatever an operator typed, so it is printed as given
		// rather than title-cased the way an oauth key is.
		expect(links[0].textContent?.trim()).toBe('Sign in with Azure AD');
	});

	it('offers both kinds of provider at once', () => {
		const { getAllByRole, getByText } = render(LoginPage, {
			props: props({ data: { oauthProviders: ['github'], samlProviders: ['Okta'] } }),
		});

		expect(getByText(/or continue with/i)).toBeTruthy();
		expect(providerLinks(getAllByRole('link')).map((a) => a.getAttribute('href'))).toEqual([
			'/api/admin/auth/oauth/github',
			'/api/admin/auth/saml/Okta',
		]);
	});

	it('hides the provider choices during the second factor step', () => {
		const { queryByText } = render(LoginPage, {
			props: props({
				form: { mfa_required: true, challenge_token: 'tok-1' },
				data: { oauthProviders: ['github'], samlProviders: [] },
			}),
		});

		expect(queryByText(/or continue with/i)).toBeNull();
	});
});

describe('Login page with a captcha challenge', () => {
	const challenged = (extra: Record<string, unknown> = {}) =>
		props({
			form: {
				error: 'Complete the security check to sign in.',
				captcha: { provider: 'turnstile', siteKey: '0x4AAA' },
				email: 'a@b.co',
				...extra,
			},
		});

	it('shows the provider widget and keeps the address that was typed', () => {
		const { container } = render(LoginPage, { props: challenged() });

		expect(container.querySelector('[data-captcha="turnstile"]')).not.toBeNull();
		expect(container.querySelector('input[name="captcha_token"]')).not.toBeNull();
		expect((container.querySelector('#email') as HTMLInputElement).value).toBe('a@b.co');
		expect(container.textContent).toContain('Complete the security check to sign in.');
	});

	it('holds Sign in until the check has issued a token', () => {
		const { getByRole } = render(LoginPage, { props: challenged() });

		expect((getByRole('button', { name: /^sign in$/i }) as HTMLButtonElement).disabled).toBe(true);
	});

	it('renders no widget before the engine asks for one', () => {
		const { container, getByRole } = render(LoginPage, { props: props() });

		expect(container.querySelector('[data-captcha]')).toBeNull();
		expect((getByRole('button', { name: /^sign in$/i }) as HTMLButtonElement).disabled).toBe(false);
	});
});

describe('Login page recovery links', () => {
	it('offers a password reset and an email sign-in link', () => {
		const { getByRole } = render(LoginPage, { props: props() });

		expect(getByRole('link', { name: /forgot password/i }).getAttribute('href')).toBe('/forgot-password');
		expect(getByRole('link', { name: /email me a sign-in link/i }).getAttribute('href')).toBe('/login/magic-link');
	});

	it('hides them during the second factor step', () => {
		const { queryByRole } = render(LoginPage, {
			props: props({ form: { mfa_required: true, challenge_token: 'tok-1' } }),
		});

		expect(queryByRole('link', { name: /forgot password/i })).toBeNull();
		expect(queryByRole('link', { name: /email me a sign-in link/i })).toBeNull();
	});
});
