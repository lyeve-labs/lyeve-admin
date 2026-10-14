// @vitest-environment jsdom
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Entitlements } from '$lib/entitlements';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));

const kit = vi.hoisted(() => ({ confirm: vi.fn(async () => false) }));
vi.mock('@lyeve-labs/ui-kit', async (importOriginal) => {
	const actual = await importOriginal<Record<string, unknown>>();
	return { ...actual, confirm: kit.confirm };
});

import WebhooksPage from './+page.svelte';

afterEach(cleanup);
beforeEach(() => {
	kit.confirm.mockReset();
	kit.confirm.mockResolvedValue(false);
});

const entitlements: Entitlements = {
	plan: 'example',
	state: 'active',
	features: ['webhook'],
	tenant_quota: 1,
};

const webhook = {
	id: 'w1',
	name: 'Ship it',
	url: 'https://example.com/hook',
	events: ['entry.created'],
	schemas: [],
	enabled: true,
	created_at: '2026-01-01T00:00:00Z',
};

function setup(roles: string[] = ['super_admin']) {
	return render(WebhooksPage, {
		props: {
			data: { webhooks: { ok: true, value: [webhook] }, schemas: { ok: true, value: [] }, entitlements, user: { roles } },
			form: null,
		} as never,
	});
}

describe('webhooks page', () => {
	it('does not delete straight from the row', async () => {
		// A row that posts ?/delete directly destroys a webhook on one click and
		// never reaches the confirmation.
		const { container } = setup();
		const rowForms = [...container.querySelectorAll('tbody form[action="?/delete"]')];
		expect(rowForms, 'a delete form is live in the row').toHaveLength(0);
	});

	it('asks first, names the webhook, and posts its id only once agreed', async () => {
		const { container, getByTitle } = setup();
		const form = container.querySelector('form[action="?/delete"]') as HTMLFormElement;
		const submit = vi.spyOn(form, 'requestSubmit').mockImplementation(() => {});

		await fireEvent.click(getByTitle('Delete'));
		await tick();
		expect(kit.confirm).toHaveBeenCalledWith('Delete webhook Ship it', expect.stringContaining('Ship it'), {
			confirmLabel: 'Delete',
		});
		expect(submit).not.toHaveBeenCalled();

		kit.confirm.mockResolvedValue(true);
		await fireEvent.click(getByTitle('Delete'));
		await tick();
		await tick();
		expect(new FormData(form).get('id')).toBe('w1');
		expect(submit).toHaveBeenCalled();
	});

	it('creates and edits in one drawer, Create on new and Save on a row', async () => {
		const { container, getAllByRole, getByRole } = setup();
		expect(container.querySelector('[role="dialog"]')).toBeNull();

		await fireEvent.click(getAllByRole('button', { name: /new webhook/i })[0]);
		let dialog = container.querySelector('[role="dialog"]') as HTMLElement;
		expect(dialog.textContent).toContain('New webhook');
		expect(dialog.querySelector('button[type="submit"]')?.textContent?.trim()).toBe('Create');
		await fireEvent.click(getByRole('button', { name: 'Cancel' }));

		await fireEvent.click(getByRole('button', { name: 'Edit Ship it' }));
		dialog = container.querySelector('[role="dialog"]') as HTMLElement;
		expect(dialog.textContent).toContain('Edit Ship it');
		expect((dialog.querySelector('#webhook-url') as HTMLInputElement).value).toBe('https://example.com/hook');
		expect(dialog.querySelector('button[type="submit"]')?.textContent?.trim()).toBe('Save');
	});
});

/*
 * The first-run state invites the reader to create the first webhook. Drawn
 * over a read that failed, it tells somebody whose engine is down that no
 * callback is configured.
 */
describe('the webhook list when it could not be read', () => {
	function failed(gate: Record<string, unknown>) {
		return render(WebhooksPage, {
			props: {
				data: { webhooks: { ok: false, gate }, schemas: { ok: true, value: [] }, entitlements, user: { roles: ['super_admin'] } },
				form: null,
			} as never,
		});
	}

	it('says the engine did not answer and offers no first webhook', () => {
		const { container, queryByRole } = failed({ state: 'unavailable' });
		expect(container.textContent).toContain('so Webhooks could not be read. Nothing was changed.');
		expect(container.textContent).not.toContain('No webhooks configured yet');
		expect(queryByRole('button', { name: /new webhook/i })).toBeNull();
		expect(container.querySelector('table')).toBeNull();
	});

	it('names the role for a refusal', () => {
		const { container } = failed({ state: 'forbidden' });
		expect(container.textContent).toContain('Your role cannot open Webhooks.');
		expect(container.textContent).not.toContain('No webhooks configured yet');
	});
});

/*
 * The webhook plugin serves create, update, delete and rotate to a super admin
 * only. An admin offered them meets a refusal after filling the form in.
 */
describe('the webhook controls by role', () => {
	it('offers an admin the reads and tests, and says who may change a webhook', () => {
		const { container, queryByRole, getByRole } = setup(['admin']);
		expect(queryByRole('button', { name: /new webhook/i })).toBeNull();
		expect(queryByRole('button', { name: 'Edit Ship it' })).toBeNull();
		expect(queryByRole('button', { name: 'Duplicate Ship it' })).toBeNull();
		expect(queryByRole('button', { name: 'Delete Ship it' })).toBeNull();
		expect(queryByRole('button', { name: /rotate the signing secret/i })).toBeNull();
		expect(getByRole('button', { name: 'Test Ship it' })).toBeTruthy();
		expect(getByRole('button', { name: 'Delivery history for Ship it' })).toBeTruthy();
		expect(container.textContent).toContain('Creating, changing or deleting one takes a super admin.');
	});

	it('offers a super admin every write', () => {
		const { container, getByRole, getAllByRole } = setup();
		expect(getAllByRole('button', { name: /new webhook/i })).toHaveLength(1);
		expect(getByRole('button', { name: 'Edit Ship it' })).toBeTruthy();
		expect(getByRole('button', { name: 'Delete Ship it' })).toBeTruthy();
		expect(getByRole('button', { name: /rotate the signing secret/i })).toBeTruthy();
		expect(container.textContent).not.toContain('takes a super admin');
	});
});

/*
 * Every form on the page shares one action result. A drawer that read it
 * whole showed a failed delete in the next New webhook form as if that form
 * had failed.
 */
describe('the webhook drawer and the failures of other actions', () => {
	const props = (form: unknown) =>
		({
			data: {
				webhooks: { ok: true, value: [webhook] },
				schemas: { ok: true, value: [] },
				entitlements,
				user: { roles: ['super_admin'] },
			},
			form,
		}) as never;
	const drawerText = () => document.body.querySelector('form#webhook-form')?.textContent ?? '';

	it('leaves a newly opened create drawer clean after a failed delete', async () => {
		const { container, getByRole } = render(WebhooksPage, { props: props({ action: 'delete', error: 'Failed to delete webhook' }) });
		expect(container.textContent).toContain('Failed to delete webhook');
		await fireEvent.click(getByRole('button', { name: /new webhook/i }));
		expect(drawerText()).not.toContain('Failed to delete webhook');
	});

	it('shows a failed save inside the open drawer, first in its form', async () => {
		const { getByRole, rerender } = render(WebhooksPage, { props: props(null) });
		await fireEvent.click(getByRole('button', { name: /new webhook/i }));
		await rerender(props({ action: 'create', error: 'Failed to create webhook' }));
		const form = document.body.querySelector('form#webhook-form') as HTMLFormElement;
		expect(form.firstElementChild?.textContent).toContain('Failed to create webhook');
	});
});

/*
 * The test result lands in a map keyed by webhook. An effect that tracked the
 * map it rewrote reran on its own write until Svelte threw.
 */
describe('the result of a webhook test', () => {
	const props = (form: unknown) =>
		({
			data: { webhooks: { ok: true, value: [webhook] }, schemas: { ok: true, value: [] }, entitlements, user: { roles: ['admin'] } },
			form,
		}) as never;

	it('settles and shows under the row it tested', async () => {
		const { container, rerender } = render(WebhooksPage, { props: props(null) });
		await rerender(props({ testResult: { id: 'w1', success: false, status_code: 502, message: 'Bad gateway' } }));
		expect(container.querySelector('tbody')?.textContent).toContain('HTTP 502: Bad gateway');
		await rerender(props({ testResult: { id: 'w1', success: true, status_code: 200, message: 'OK' } }));
		expect(container.querySelector('tbody')?.textContent).toContain('HTTP 200: OK');
	});
});

/*
 * The plugin generates the new secret and shows it once. The page used to
 * toast "Rotated the secret for undefined" and drop the secret, so the
 * receiver could no longer verify a signature and nobody could learn why.
 */
describe('a rotated signing secret', () => {
	const props = (form: unknown) =>
		({
			data: { webhooks: { ok: true, value: [webhook] }, schemas: { ok: true, value: [] }, entitlements, user: { roles: ['super_admin'] } },
			form,
		}) as never;

	it('is shown once in a panel that names the webhook and copies the secret', async () => {
		const { rerender } = render(WebhooksPage, { props: props(null) });
		await rerender(props({ rotated: { id: 'w1', name: 'Ship it', secret: 'c0ffee-secret' } }));
		const dialog = document.body.querySelector('[role="dialog"]') as HTMLElement;
		expect(dialog.textContent).toContain('New signing secret for Ship it');
		expect(dialog.textContent).toContain('It is not shown again.');
		const values = [...dialog.querySelectorAll('input')].map((i) => i.value);
		expect(values).toContain('c0ffee-secret');
	});
});

describe('the failures of the history and the queue', () => {
	const props = (form: unknown) =>
		({
			data: { webhooks: { ok: true, value: [webhook] }, schemas: { ok: true, value: [] }, entitlements, user: { roles: ['admin'] } },
			form,
		}) as never;

	it.each(['retry-delivery', 'dead-letter-replay', 'dead-letter-dismiss', 'dead-letter-delete'])(
		'leaves a failed %s to its drawer rather than the page behind it',
		(action) => {
			const { container } = render(WebhooksPage, { props: props({ action, error: 'refused here' }) });
			expect(container.textContent).not.toContain('refused here');
		},
	);

	it('still reports a queue that could not be opened above the list', () => {
		const { container } = render(WebhooksPage, { props: props({ action: 'dead-letters', error: 'Failed to load dead letters' }) });
		expect(container.textContent).toContain('Failed to load dead letters');
	});
});
