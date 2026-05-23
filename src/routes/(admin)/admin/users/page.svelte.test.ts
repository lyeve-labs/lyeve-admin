// @vitest-environment jsdom
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/navigation', () => ({
	goto: vi.fn(async () => {}),
	invalidateAll: vi.fn(async () => {}),
}));
vi.mock('$app/forms', () => ({ enhance: () => ({ destroy: () => {} }) }));

import UsersPage from './+page.svelte';

afterEach(cleanup);

function accounts(count: number, from = 0) {
	return Array.from({ length: count }, (_, i) => ({
		id: `u${from + i}`,
		email: `user${from + i}@b.co`,
		roles: ['editor'],
		tenant_id: 't1',
		disabled: false,
		created_at: '2026-01-01T00:00:00Z',
	}));
}

function data(overrides: Record<string, unknown> = {}) {
	return { users: accounts(25), limit: 25, offset: 0, hasMore: false, tenants: [], ...overrides };
}

const props = (over: Record<string, unknown> = {}) =>
	({ data: data(over) as never, form: null as never });

function pager(container: HTMLElement, label: string): HTMLElement | undefined {
	// The kit's pager draws its steps as an arrow and names them in aria-label,
	// so a step is found by its accessible name and not by the text it carries.
	return [...container.querySelectorAll('a, button')].find(
		(el) => el.textContent?.includes(label) || el.getAttribute('aria-label')?.includes(label)
	) as HTMLElement | undefined;
}

/*
 * `toLocale*` with no locale reads the same row differently in two browsers,
 * and differently again between the server render and the hydrated one. So
 * the Created column formats its date through $lib/format.
 */
describe('Users dates', () => {
	it('renders the created day as an ISO day, whatever zone the reader is in', () => {
		const { container } = render(UsersPage, { props: props({ users: accounts(1) }) });

		expect(container.textContent).toContain('2026-01-01');
	});

	it('names the gap rather than printing an invalid date', () => {
		const rows = accounts(1);
		rows[0].created_at = '';
		const { container } = render(UsersPage, { props: props({ users: rows }) });

		expect(container.textContent).toContain('Unknown');
		expect(container.textContent).not.toContain('Invalid Date');
	});
});

/*
 * The create form opens in a modal with a scrim and a close control, so it
 * reads as something that is open rather than as part of the page.
 */
describe('Users create', () => {
	it('keeps the form out of the page until it is asked for', () => {
		const { container } = render(UsersPage, { props: props() });

		expect(container.querySelector('[role="dialog"]')).toBeNull();
	});

	it('opens the form as a dialog', async () => {
		const { container, getAllByRole } = render(UsersPage, { props: props() });

		await fireEvent.click(getAllByRole('button', { name: /new user/i })[0]);

		const dialog = container.querySelector('[role="dialog"]');
		expect(dialog).toBeTruthy();
		expect(dialog?.textContent).toContain('New user');
	});

	it('gives the dialog a close control of its own', async () => {
		const { getAllByRole, getByRole } = render(UsersPage, { props: props() });

		await fireEvent.click(getAllByRole('button', { name: /new user/i })[0]);

		expect(getByRole('button', { name: /close/i })).toBeTruthy();
	});

	// The roles offered here and on the API key page are the same list.
	it('offers every role the instance issues', async () => {
		const { container, getAllByRole } = render(UsersPage, { props: props() });

		await fireEvent.click(getAllByRole('button', { name: /new user/i })[0]);

		const dialog = container.querySelector('[role="dialog"]') as HTMLElement;
		const roles = [...dialog.querySelectorAll('input[name="roles"]')].map(
			(el) => (el as HTMLInputElement).value
		);
		expect(roles).toEqual(['viewer', 'editor', 'admin', 'super_admin']);
	});
});

/**
 * A list that ends at the engine's default page with no way forward makes an
 * instance with more accounts than that look complete.
 */
describe('Users pagination', () => {
	it('offers the next page as a link carrying the advanced offset', () => {
		const { container } = render(UsersPage, { props: props({ hasMore: true }) });

		expect(pager(container, 'Next')?.getAttribute('href')).toBe(
			'/admin/users?limit=25&offset=25'
		);
	});

	it('links back once past the first page', () => {
		const { container } = render(UsersPage, {
			props: props({ offset: 50, users: accounts(25, 50), hasMore: true }),
		});

		expect(pager(container, 'Prev')?.getAttribute('href')).toBe(
			'/admin/users?limit=25&offset=25'
		);
	});

	// The endpoint sends no row count, so the pager states the slice it is
	// showing rather than a total nobody measured.
	it('names the accounts on screen rather than a total it cannot know', () => {
		const { container } = render(UsersPage, {
			props: props({ offset: 25, users: accounts(25, 25), hasMore: true }),
		});

		expect(container.textContent).toContain('accounts 26 to 50');
	});

	it('renders no pager at all when one page holds everything', () => {
		const { container } = render(UsersPage, { props: props({ users: accounts(3) }) });

		expect(pager(container, 'Next')).toBeUndefined();
		expect(pager(container, 'Prev')).toBeUndefined();
	});

	it('offers no forward link on the last page', () => {
		const { container } = render(UsersPage, {
			props: props({ offset: 25, users: accounts(10, 25), hasMore: false }),
		});

		expect(pager(container, 'Next')?.getAttribute('href')).toBeNull();
	});
});

/*
 * The browser's own bubble is unstyled, shows one field at a time, is gone on
 * the next click and is never announced. The action answers per field and the
 * message reaches the control that was rejected, which is what carries
 * aria-invalid and the paragraph its aria-describedby points at.
 */
describe('Users form errors', () => {
	const rejected = {
		error: 'Check the highlighted fields.',
		fields: { email: 'Email is required', password: 'Password must be at least 8 characters' },
	};

	async function openCreate(form: unknown) {
		const rendered = render(UsersPage, {
			props: { data: data() as never, form: form as never },
		});
		await fireEvent.click(rendered.getAllByRole('button', { name: /new user/i })[0]);
		return rendered;
	}

	it('marks the rejected control invalid', async () => {
		const { container } = await openCreate(rejected);

		const email = container.querySelector('#new-email');
		expect(email?.getAttribute('aria-invalid')).toBe('true');
	});

	it('points the control at the message that explains it', async () => {
		const { container } = await openCreate(rejected);

		const email = container.querySelector('#new-email');
		const describedBy = email?.getAttribute('aria-describedby');
		expect(describedBy).toBe('new-email-error');
		expect(container.querySelector(`#${describedBy}`)?.textContent).toBe('Email is required');
	});

	it('puts the message on each rejected control rather than one banner', async () => {
		const { container } = await openCreate(rejected);

		expect(container.querySelector('#new-pw')?.getAttribute('aria-invalid')).toBe('true');
		expect(container.querySelector('#new-pw-error')?.textContent).toBe(
			'Password must be at least 8 characters'
		);
	});

	// The region is mounted before there is anything in it: an element carrying
	// role="alert" that was not in the tree when the failure happened is
	// announced inconsistently.
	it('announces the rejection through a live region', async () => {
		const { container } = await openCreate(rejected);

		const region = container.querySelector('[aria-live="assertive"]');
		expect(region).toBeTruthy();
		expect(region?.textContent).toContain('2 fields need attention.');
	});

	it('leaves the controls unmarked when the action did not reject them', async () => {
		const { container } = await openCreate(null);

		expect(container.querySelector('#new-email')?.hasAttribute('aria-invalid')).toBe(false);
	});
});

/*
 * A super admin sets a password from the row. The engine judges it and ends
 * every session the account held. The drawer states no rule of its own and
 * shows the refusal on the control.
 */
describe('Users set password', () => {
	const refused = {
		error: 'Check the highlighted field.',
		fields: { new_password: 'password must be at least 12 characters' },
	};

	async function openSetPassword(form: unknown) {
		const rendered = render(UsersPage, {
			props: { data: data({ users: accounts(1) }) as never, form: form as never },
		});
		await fireEvent.click(rendered.getByRole('button', { name: /set password for user0@b\.co/i }));
		return rendered;
	}

	it('offers the action on every row', () => {
		const { getAllByRole } = render(UsersPage, { props: props({ users: accounts(3) }) });

		expect(getAllByRole('button', { name: /^set password for /i })).toHaveLength(3);
	});

	it('opens a drawer that names the account and posts to setPassword', async () => {
		const { container } = await openSetPassword(null);

		const dialog = container.querySelector('[role="dialog"]');
		expect(dialog?.textContent).toContain('Set password for user0@b.co');
		expect(dialog?.textContent).toContain('signed out of every session');
		const form = dialog?.querySelector('form');
		expect(form?.getAttribute('action')).toBe('?/setPassword');
		expect((form?.querySelector('input[name="id"]') as HTMLInputElement).value).toBe('u0');
		expect(form?.querySelector('input[name="new_password"]')).toBeTruthy();
	});

	it('shows the engine refusal on the password control', async () => {
		const { container } = await openSetPassword(refused);

		const control = container.querySelector('#set-pw');
		expect(control?.getAttribute('aria-invalid')).toBe('true');
		expect(container.querySelector('#set-pw-error')?.textContent).toBe(
			'password must be at least 12 characters'
		);
	});

	// The two drawers each carry a password control. A refusal from one must
	// not mark the other, so the fields are named apart.
	it('leaves the create form unmarked by a set password refusal', async () => {
		const { getAllByRole, container } = render(UsersPage, {
			props: { data: data() as never, form: refused as never },
		});
		await fireEvent.click(getAllByRole('button', { name: /new user/i })[0]);

		expect(container.querySelector('#new-pw')?.hasAttribute('aria-invalid')).toBe(false);
	});

	it('leaves the control unmarked when nothing was refused', async () => {
		const { container } = await openSetPassword(null);

		expect(container.querySelector('#set-pw')?.hasAttribute('aria-invalid')).toBe(false);
	});
});

describe('Users create, several tenants', () => {
	it('asks which tenant the account belongs to only when there are several', async () => {
		const one = render(UsersPage, { props: props({ tenants: [{ slug: 'acme', name: 'Acme' }] }) });
		await fireEvent.click(one.getAllByRole('button', { name: /new user/i })[0]);
		expect(one.container.ownerDocument.querySelector('#new-tenant')).toBeNull();
		one.unmount();

		const two = render(UsersPage, { props: props({ tenants: [{ slug: 'acme', name: 'Acme' }, { slug: 'globex', name: 'Globex' }] }) });
		await fireEvent.click(two.getAllByRole('button', { name: /new user/i })[0]);
		expect(two.container.ownerDocument.querySelector('#new-tenant')).toBeTruthy();
		expect(two.container.ownerDocument.querySelector('input[name="tenant_required"]')).toBeTruthy();
	});
});

