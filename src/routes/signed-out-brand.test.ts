// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/svelte';
import type { Component } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ page: { data: {} as Record<string, unknown> } }));
vi.mock('$app/state', () => state);

import LoginPage from './login/+page.svelte';
import ForgotPage from './forgot-password/+page.svelte';
import ResetPage from './reset-password/+page.svelte';

afterEach(() => {
	cleanup();
	state.page.data = {};
});

const LOGO = '/api/v1/media/1/logo.png';

/*
 * Every signed-out card a reader meets on the way in: the sign-in, its second
 * factor step, the request for a reset link and the new password. Each one
 * carries the tenant's lockup and accent, the way the frame drew them before
 * it was built on the kit's.
 */
const PAGES: [string, Component, Record<string, unknown>][] = [
	['the sign-in', LoginPage as Component, { form: null, data: { oauthProviders: [], samlProviders: [] } }],
	[
		'the second factor step',
		LoginPage as Component,
		{ form: { mfa_required: true, challenge_token: 'tok-1' }, data: { oauthProviders: [], samlProviders: [] } },
	],
	['the reset request', ForgotPage as Component, { form: null, data: {} }],
	['the new password', ResetPage as Component, { form: null, data: { token: 'reset-1', minLength: 12 } }],
];

describe('signed-out pages', () => {
	it.each(PAGES)('%s draws the tenant logo, name and accent', (_name, Page, props) => {
		state.page.data = { brand: { name: 'Acme Studio', logo_url: LOGO, accent: '#0a7cff', favicon_url: '' } };
		const { container, getByTestId } = render(Page, { props: props as never });

		const lockup = getByTestId('tenant-brand');
		expect(lockup.querySelector('img')!.getAttribute('src')).toBe(LOGO);
		expect(lockup.textContent).toContain('Acme Studio');
		const main = container.querySelector('main')!;
		expect(main.classList.contains('tenant-accent')).toBe(true);
		expect(main.getAttribute('style')).toContain('--tenant-brand-on-dark');
		// The lockup sits above the one heading, in the frame's centered column.
		expect(lockup.compareDocumentPosition(container.querySelector('h1')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
		expect(container.querySelectorAll('h1')).toHaveLength(1);
	});

	it.each(PAGES)('%s draws the tenant name beside the product mark without a logo', (_name, Page, props) => {
		state.page.data = { brand: { name: 'Acme Studio', logo_url: '', accent: '', favicon_url: '' } };
		const { container, getByTestId } = render(Page, { props: props as never });

		expect(getByTestId('tenant-brand').querySelector('svg')).toBeTruthy();
		expect(getByTestId('tenant-brand').textContent).toContain('Acme Studio');
		expect(container.querySelector('main')!.classList.contains('tenant-accent')).toBe(false);
		expect(container.querySelector('main')!.hasAttribute('style')).toBe(false);
	});

	it.each(PAGES)('%s draws the product lockup for a tenant with no brand', (_name, Page, props) => {
		const { container, queryByTestId, getByText } = render(Page, { props: props as never });

		expect(queryByTestId('tenant-brand')).toBeNull();
		expect(getByText('LyEve')).toBeTruthy();
		expect(container.querySelector('main')!.classList.contains('tenant-accent')).toBe(false);
	});
});
