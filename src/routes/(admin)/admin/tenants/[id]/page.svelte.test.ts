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
