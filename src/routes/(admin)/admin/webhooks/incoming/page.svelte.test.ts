// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));

import IncomingPage from './+page.svelte';

afterEach(cleanup);

const entitlements = { plan: 'example', state: 'active', features: ['webhook'], tenant_quota: 1 };

const stripe = {
	id: 'i1',
	name: 'Stripe',
	schema_name: 'orders',
	enabled: true,
	field_map: { id: 'external_id' },
	allowed_ips: [],
};

function setup(over: Record<string, unknown> = {}, form: unknown = null) {
	return render(IncomingPage, {
		props: {
			data: {
				incomingWebhooks: { ok: true, value: [stripe] },
				schemas: { ok: true, value: [{ name: 'orders' }] },
				entitlements,
				user: { roles: ['super_admin'] },
				...over,
			},
			form,
		} as never,
	});
}

describe('the incoming webhook list when it could not be read', () => {
	it('says the engine did not answer and offers no first endpoint', () => {
		const { container, queryByRole } = setup({ incomingWebhooks: { ok: false, gate: { state: 'unavailable' } } });
		expect(container.textContent).toContain('so Incoming webhooks could not be read. Nothing was changed.');
		expect(container.textContent).not.toContain('No incoming webhooks');
		expect(queryByRole('button', { name: /new incoming webhook/i })).toBeNull();
	});

	it('keeps the first-run state for a list that answered empty', () => {
		const { container, getAllByRole } = setup({ incomingWebhooks: { ok: true, value: [] } });
		expect(container.textContent).toContain('No incoming webhooks');
		expect(getAllByRole('button', { name: /new incoming webhook/i })).toHaveLength(2);
	});
});

/*
 * The webhook plugin serves create, update and delete to a super admin only.
 * An admin offered them meets a refusal after filling the form in.
 */
describe('the incoming webhook controls by role', () => {
	it('offers an admin no write and says who may make one', () => {
		const { container, queryByRole } = setup({ user: { roles: ['admin'] } });
		expect(container.textContent).toContain('Stripe');
		expect(queryByRole('button', { name: /new incoming webhook/i })).toBeNull();
		expect(queryByRole('button', { name: 'Edit Stripe' })).toBeNull();
		expect(queryByRole('button', { name: 'Delete Stripe' })).toBeNull();
		expect(container.textContent).toContain('Creating, changing or deleting one takes a super admin.');
	});

	it('offers a super admin every write', () => {
		const { getByRole } = setup();
		expect(getByRole('button', { name: /new incoming webhook/i })).toBeTruthy();
		expect(getByRole('button', { name: 'Edit Stripe' })).toBeTruthy();
		expect(getByRole('button', { name: 'Delete Stripe' })).toBeTruthy();
	});
});

/*
 * Every form on the page shares one action result. A drawer that read it
 * whole showed a failed delete in the next form opened as if that form had
 * failed.
 */
describe('the incoming webhook drawer and the failures of other actions', () => {
	const drawerText = () => document.body.querySelector('form#incoming-form')?.textContent ?? '';

	it('leaves a newly opened create drawer clean after a failed delete', async () => {
		const { container, getByRole } = setup({}, { action: 'delete', error: 'Failed to delete incoming webhook' });
		expect(container.textContent).toContain('Failed to delete incoming webhook');
		await fireEvent.click(getByRole('button', { name: /new incoming webhook/i }));
		expect(drawerText()).not.toContain('Failed to delete incoming webhook');
	});

	it('shows a failed save inside the open drawer, first in its form', async () => {
		const { getByRole, rerender } = setup();
		await fireEvent.click(getByRole('button', { name: 'Edit Stripe' }));
		await rerender({
			data: {
				incomingWebhooks: { ok: true, value: [stripe] },
				schemas: { ok: true, value: [{ name: 'orders' }] },
				entitlements,
				user: { roles: ['super_admin'] },
			},
			form: { action: 'update', error: 'Field map must be valid JSON.' },
		} as never);
		const form = document.body.querySelector('form#incoming-form') as HTMLFormElement;
		expect(form.firstElementChild?.textContent).toContain('Field map must be valid JSON.');
	});
});
