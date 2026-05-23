// @vitest-environment jsdom
import { render, cleanup } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
	page: { status: 500, error: null as { message: string } | null },
}));

vi.mock('$app/state', () => state);

import RootError from './+error.svelte';

afterEach(cleanup);

function renderAt(status: number, message = '') {
	state.page.status = status;
	state.page.error = message ? { message } : null;
	return render(RootError);
}

describe('Root error page', () => {
	it('shows the status code carried by the page state', () => {
		const { getByText } = renderAt(404);
		expect(getByText('404')).toBeTruthy();
	});

	it('renders the not-found face for 404', () => {
		const { getByText } = renderAt(404, 'gone');
		expect(getByText('Not found')).toBeTruthy();
		expect(getByText('gone')).toBeTruthy();
	});

	it('offers a sign-in link for 401', () => {
		const { getByText, getByRole } = renderAt(401);
		expect(getByText('Not signed in')).toBeTruthy();
		expect(getByRole('link', { name: /sign in/i }).getAttribute('href')).toBe('/login');
	});

	it('keeps the server face for 500', () => {
		const { getByText } = renderAt(500);
		expect(getByText('Something went wrong')).toBeTruthy();
	});
});
