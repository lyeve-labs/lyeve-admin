// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));

import TenantPage from './+page.svelte';

afterEach(cleanup);

const tenant = {
	id: 't1',
	slug: 'acme',
	name: 'Acme',
	plan: 'example',
	enabled: true,
	archived: false,
	created_at: '2026-01-01T00:00:00Z',
	updated_at: '2026-01-01T00:00:00Z',
};

const member = { id: 'u2', email: 'ada@example.com', disabled: false, home: false, roles: ['editor'] };

function props(over: Record<string, unknown> = {}, form: unknown = null) {
	return {
		data: {
			tenant,
			choices: { ok: true, value: [{ name: 'flow', available: true }] },
			members: { ok: true, value: [member] },
			memberTotal: 1,
			limit: 50,
			offset: 0,
			user: { roles: ['super_admin'] },
			...over,
		},
		form,
	} as never;
}

const drawerText = () => document.body.querySelector('form#member-form')?.textContent ?? '';

describe('tenant detail reads that failed', () => {
	it('says the members could not be read and offers no new member', () => {
		const { container } = render(TenantPage, { props: props({ members: { ok: false, gate: { state: 'unavailable' } } }) });
		expect(container.textContent).toContain("so this tenant's members could not be read");
		expect(container.textContent).not.toContain('No members');
		expect(screen.queryByRole('button', { name: /new member/i })).toBeNull();
	});
});

/*
 * A grant and a removal share one action result. The member drawer showed a
 * failed removal in the next form opened as if that form had failed.
 */
describe('the member drawer and the failures of other actions', () => {
	it('leaves a newly opened member drawer clean after a failed removal', async () => {
		const { container } = render(TenantPage, {
			props: props({}, { action: 'revoke', memberError: 'The membership could not be removed.' }),
		});
		expect(container.textContent).toContain('The membership could not be removed.');
		await fireEvent.click(screen.getByRole('button', { name: /new member/i }));
		expect(drawerText()).not.toContain('could not be removed');
	});

	it('shows a failed grant inside the open drawer, first in its form', async () => {
		const { rerender } = render(TenantPage, { props: props() });
		await fireEvent.click(screen.getByRole('button', { name: /new member/i }));
		await rerender(props({}, { action: 'grant', memberError: 'Choose at least one role.', fields: { roles: 'Required' } }));
		const form = document.body.querySelector('form#member-form') as HTMLFormElement;
		expect(form.firstElementChild?.textContent).toContain('Choose at least one role.');
	});
});

describe('what this tenant may use', () => {
	it('picks the plugins from a searchable list and posts each one kept', () => {
		const { container } = render(TenantPage, {
			props: props({
				choices: {
					ok: true,
					value: [
						{ name: 'flow', available: true },
						{ name: 'search', available: false },
						{ name: 'ai', available: true },
					],
				},
			}),
		});
		expect(container.querySelectorAll('input[type="checkbox"][name="available"]')).toHaveLength(0);
		expect(container.querySelector('#tenant-features')).toBeTruthy();
		const kept = [...container.querySelectorAll('input[type="hidden"][name="available"]')].map((i) => (i as HTMLInputElement).value);
		expect(kept.sort()).toEqual(['ai', 'flow']);
		const offered = [...container.querySelectorAll('input[name="offered"]')].map((i) => (i as HTMLInputElement).value);
		expect(offered.sort()).toEqual(['ai', 'flow', 'search']);
	});
});

describe('the members of a large tenant', () => {
	it('pages the members rather than stopping at the first page', () => {
		const members = Array.from({ length: 50 }, (_, i) => ({ ...member, id: `u${i}`, email: `m${i}@example.com` }));
		render(TenantPage, { props: props({ members: { ok: true, value: members }, memberTotal: 230 }) });
		expect(screen.getByRole('link', { name: 'Next page' }).getAttribute('href')).toBe('/admin/tenants/t1?limit=50&offset=50');
		expect(document.body.textContent).toContain('of 230');
	});
});

/*
 * The members pager reruns the load, which hands back an equal choice list as
 * a new object. Reseeding the picks from it undid a change not yet saved.
 */
describe('unsaved plugin picks', () => {
	const choices = () => ({
		ok: true,
		value: [
			{ name: 'flow', available: true },
			{ name: 'ai', available: true },
		],
	});
	const kept = () =>
		[...document.querySelectorAll('input[type="hidden"][name="available"]')].map((i) => (i as HTMLInputElement).value);

	it('survive a turn of the members page', async () => {
		const { rerender } = render(TenantPage, { props: props({ choices: choices() }) });
		await fireEvent.click(screen.getByRole('button', { name: 'Remove flow' }));
		expect(kept()).toEqual(['ai']);
		await rerender(props({ choices: choices(), offset: 50 }));
		expect(kept()).toEqual(['ai']);
	});

	it('follow what the engine stores once it changes', async () => {
		const { rerender } = render(TenantPage, { props: props({ choices: choices() }) });
		await fireEvent.click(screen.getByRole('button', { name: 'Remove flow' }));
		await rerender(
			props({
				choices: {
					ok: true,
					value: [
						{ name: 'flow', available: true },
						{ name: 'ai', available: false },
					],
				},
			}),
		);
		expect(kept()).toEqual(['flow']);
	});
});

/*
 * The engine signs a home tenant in with the roles saved on its home row, so
 * a save that dropped super_admin there ended the account's super admin at
 * its next sign-in.
 */
describe('editing the roles of a super admin', () => {
	const root = { id: 'u1', email: 'root@example.com', disabled: false, home: true, roles: ['super_admin', 'admin'] };

	it('posts super_admin back with the roles picked, and says where it is managed', async () => {
		render(TenantPage, { props: props({ members: { ok: true, value: [root] } }) });
		await fireEvent.click(screen.getByRole('button', { name: 'Edit roles for root@example.com' }));
		const form = document.body.querySelector<HTMLFormElement>('form#member-form');
		const posted = new FormData(form!).getAll('roles');
		expect(posted).toContain('super_admin');
		expect(posted).toContain('admin');
		expect(drawerText()).toContain('The super admin role is managed on the Users page.');
	});

	it('adds nothing for an account that is not a super admin', async () => {
		render(TenantPage, { props: props() });
		await fireEvent.click(screen.getByRole('button', { name: 'Edit roles for ada@example.com' }));
		const form = document.body.querySelector<HTMLFormElement>('form#member-form');
		expect(new FormData(form!).getAll('roles')).not.toContain('super_admin');
		expect(screen.queryByTestId('keeps-super-admin')).toBeNull();
	});
});

describe('a tenant with no members', () => {
	it('offers the action that adds one', () => {
		const { container } = render(TenantPage, { props: props({ members: { ok: true, value: [] }, memberTotal: 0 }) });
		expect(container.textContent).toContain('No members');
		expect(screen.getAllByRole('button', { name: /new member/i }).length).toBe(2);
	});
});
