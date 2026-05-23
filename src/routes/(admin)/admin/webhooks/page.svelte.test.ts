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

function setup() {
	return render(WebhooksPage, {
		props: { data: { webhooks: [webhook], schemas: [], entitlements }, form: null } as never,
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
		expect(kit.confirm).toHaveBeenCalledWith('Delete webhook', expect.stringContaining('Ship it'), {
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
