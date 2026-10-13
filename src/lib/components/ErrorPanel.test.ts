// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OUTAGE } from '$lib/outage';

const state = vi.hoisted(() => ({
	page: { url: new URL('http://admin.test/admin') },
}));

vi.mock('$app/state', () => state);

import ErrorPanel from './ErrorPanel.svelte';

afterEach(cleanup);

function mount(status: number, message = '', at = 'http://admin.test/admin') {
	state.page.url = new URL(at);
	return render(ErrorPanel, { props: { status, message, homeHref: '/admin', homeLabel: 'Dashboard' } });
}

describe('ErrorPanel', () => {
	describe('a reader the engine knows and refuses', () => {
		it('says why, in the words the load gave', () => {
			const { getByText } = mount(403, 'Requires super_admin role');
			expect(getByText('Access denied')).toBeTruthy();
			expect(getByText('Requires super_admin role')).toBeTruthy();
		});

		it('falls back to a plain refusal when the load gave no words', () => {
			expect(mount(403).getByText('This account cannot open that page.')).toBeTruthy();
		});

		it('leads with the dashboard and never offers to sign in', () => {
			const { getAllByRole, queryByRole } = mount(403, 'Requires the admin role');
			expect(queryByRole('link', { name: /sign in/i })).toBeNull();
			const [first] = getAllByRole('link');
			expect(first.textContent?.trim()).toBe('Dashboard');
			expect(first.getAttribute('href')).toBe('/admin');
		});
	});

	it('still sends an expired session to sign in', () => {
		const { getByText, getByRole } = mount(401);
		expect(getByText('Not signed in')).toBeTruthy();
		expect(getByRole('link', { name: /sign in/i }).getAttribute('href')).toBe('/login');
	});

	describe('an engine that did not answer', () => {
		it('says the session survived and nothing changed', () => {
			const { getByText } = mount(503, OUTAGE.body);
			expect(getByText(OUTAGE.title)).toBeTruthy();
			expect(getByText(OUTAGE.body)).toBeTruthy();
		});

		it('offers one retry of the same address, query included, as a plain link', () => {
			const { getAllByRole } = mount(503, '', 'http://admin.test/admin/content/posts?page=2&sort=title');
			const links = getAllByRole('link');
			expect(links).toHaveLength(1);
			expect(links[0].textContent?.trim()).toBe(OUTAGE.action);
			expect(links[0].getAttribute('href')).toBe('/admin/content/posts?page=2&sort=title');
		});

		it('never asks a reader who is still signed in to sign in', () => {
			const { queryByRole } = mount(503);
			expect(queryByRole('link', { name: /sign in/i })).toBeNull();
		});

		it('keeps the detail block for other server failures only', () => {
			expect(mount(503, 'The experiment could not be read').queryByText('What the server said')).toBeNull();
			cleanup();
			expect(mount(500, 'boom').getByText('What the server said')).toBeTruthy();
		});
	});
});
