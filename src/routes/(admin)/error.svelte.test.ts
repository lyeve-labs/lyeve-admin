// @vitest-environment jsdom
import { render, cleanup } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
	page: { status: 500, error: null as { message: string } | null, url: new URL('http://admin.test/admin/content/posts?page=2') },
}));

vi.mock('$app/state', () => state);

import AdminError from './+error.svelte';
import { OUTAGE } from '$lib/outage';

afterEach(cleanup);

function renderAt(status: number, message = '') {
	state.page.status = status;
	state.page.error = message ? { message } : null;
	return render(AdminError);
}

describe('Admin error page', () => {
	it('shows the status code carried by the page state', () => {
		const { getByText } = renderAt(404);
		expect(getByText('404')).toBeTruthy();
	});

	it('renders the not-found face for 404', () => {
		const { getByText } = renderAt(404, 'no such job');
		expect(getByText('Not found')).toBeTruthy();
		expect(getByText('no such job')).toBeTruthy();
	});

	it('offers a sign-in link for 401', () => {
		const { getByText, getByRole } = renderAt(401);
		expect(getByText('Not signed in')).toBeTruthy();
		expect(getByRole('link', { name: /sign in/i }).getAttribute('href')).toBe('/login');
	});

	it('renders the access-denied face for 403', () => {
		const { getByText, queryByRole } = renderAt(403);
		expect(getByText('Access denied')).toBeTruthy();
		expect(queryByRole('link', { name: /sign in/i })).toBeTruthy();
	});

	it('keeps the server face and the detail block for 500', () => {
		const { getByText } = renderAt(500, 'boom');
		expect(getByText('Something went wrong')).toBeTruthy();
		expect(getByText('What the server said')).toBeTruthy();
		expect(getByText('boom')).toBeTruthy();
	});

	it('renders the outage face for 503, with a retry of the same address', () => {
		const { getByText, getByRole, queryByRole } = renderAt(503, 'The customization could not be read.');
		expect(getByText(OUTAGE.title)).toBeTruthy();
		expect(getByText(OUTAGE.body)).toBeTruthy();
		expect(getByRole('link', { name: OUTAGE.action }).getAttribute('href')).toBe('/admin/content/posts?page=2');
		expect(queryByRole('link', { name: /sign in/i })).toBeNull();
		expect(document.title).toContain(OUTAGE.title);
	});
});
