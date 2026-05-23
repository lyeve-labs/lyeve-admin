// @vitest-environment jsdom
import { render, cleanup } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ page: { data: {} as Record<string, unknown> } }));
vi.mock('$app/state', () => state);

import AuthShell from './AuthShell.svelte';
import Body from './auth-shell-body.test.svelte';

afterEach(() => {
	cleanup();
	state.page.data = {};
});

// A component stands in for a snippet: both are called the same way by
// {@render}, and a test cannot declare a snippet outside a .svelte file.
const props = (extra: Record<string, unknown> = {}) =>
	({ title: 'Sign in to your account', children: Body, ...extra }) as never;

describe('AuthShell', () => {
	it('renders the title as the page heading and nothing else as one', () => {
		const { container } = render(AuthShell, { props: props() });

		const headings = container.querySelectorAll('h1');
		expect(headings.length).toBe(1);
		expect(headings[0].textContent?.trim()).toBe('Sign in to your account');
	});

	// Sign-in and setup are the same card at the same width, so their headings
	// match. The size belongs to the shell, not to the page.
	it('gives every signed-out page the same heading treatment', () => {
		const first = render(AuthShell, { props: props({ title: 'A' }) });
		const second = render(AuthShell, { props: props({ title: 'B' }) });

		expect(first.container.querySelector('h1')!.className).toBe(
			second.container.querySelector('h1')!.className,
		);
	});

	it('carries the product lockup above the heading', () => {
		const { container, getByText } = render(AuthShell, { props: props() });

		expect(container.querySelector('svg')).toBeTruthy();
		expect(getByText('LyEve')).toBeTruthy();
	});

	it('renders the children inside the card', () => {
		const { getByTestId } = render(AuthShell, { props: props() });

		expect(getByTestId('body')).toBeTruthy();
	});

	it('renders a description only when it is given', () => {
		const without = render(AuthShell, { props: props() });
		expect(without.queryByText('Create your super admin account.')).toBeNull();

		const withOne = render(AuthShell, {
			props: props({ description: 'Create your super admin account.' }),
		});
		expect(withOne.getByText('Create your super admin account.')).toBeTruthy();
	});

	// The card is the shell's, not the page's.
	it('puts the children on a card surface', () => {
		const { getByTestId } = render(AuthShell, { props: props() });

		expect(getByTestId('body').closest('.bg-surface')).toBeTruthy();
	});

	// The page has no shell around it, so the shell owns the gutter and the
	// column width. A page that adds its own would drift from the other.
	it('owns the column width so a page never states one', () => {
		const { container } = render(AuthShell, { props: props() });

		const main = container.querySelector('main')!;
		expect(main.className).toContain('min-h-screen');
		expect(main.className).toContain('bg-ink');
		expect(main.querySelector('.max-w-md')).toBeTruthy();
	});

	// The tenant's name and logo show on the signed-out frame too.
	it('carries the tenant logo and name when the brand sets them', () => {
		state.page.data = { brand: { name: 'Acme Studio', logo_url: '/api/v1/media/1/logo.png', accent: '', favicon_url: '' } };
		const { getByTestId, getByText, queryByText } = render(AuthShell, { props: props() });

		const lockup = getByTestId('tenant-brand');
		expect(lockup.querySelector('img')!.getAttribute('src')).toBe('/api/v1/media/1/logo.png');
		expect(getByText('Acme Studio')).toBeTruthy();
		expect(queryByText('LyEve')).toBeNull();
	});

	it('puts the tenant name beside the product mark when there is no logo', () => {
		state.page.data = { brand: { name: 'Acme Studio', logo_url: '', accent: '', favicon_url: '' } };
		const { getByTestId } = render(AuthShell, { props: props() });

		expect(getByTestId('tenant-brand').textContent).toContain('Acme Studio');
		expect(getByTestId('tenant-brand').querySelector('svg')).toBeTruthy();
	});

	it('paints the tenant accent on the signed-out page', () => {
		state.page.data = { brand: { name: '', logo_url: '', accent: '#0a7cff', favicon_url: '' } };
		const { container } = render(AuthShell, { props: props() });

		const main = container.querySelector('main')!;
		expect(main.classList.contains('tenant-accent')).toBe(true);
		expect(main.getAttribute('style')).toContain('--tenant-brand-on-dark');
	});
});
