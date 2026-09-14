// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import VariablesPage from './+page.svelte';
import type { Entitlements } from '$lib/entitlements';
import type { Variable } from '$lib/api/flows';

vi.mock('$app/state', () => ({ page: { url: new URL('http://localhost/admin/flows/variables') } }));
vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));

afterEach(cleanup);

const licensed: Entitlements = { plan: 'example', state: 'active', features: ['flow'], tenant_quota: 1 };

const variables: Variable[] = [
	{ key: 'region', value: 'eu', is_secret: false, updated_at: '2026-09-01T00:00:00Z' },
	{ key: 'api_key', is_secret: true, updated_at: '2026-09-01T00:00:00Z' },
];

function setup(rows: Variable[] = variables, form: unknown = null, locked = false, loadError: string | null = null) {
	return render(VariablesPage, {
		props: { data: { variables: rows, locked, loadError, entitlements: licensed }, form } as never,
	});
}

describe('variables page', () => {
	it('lists values in the clear and masks a secret', () => {
		const { container } = setup();
		const rows = container.querySelectorAll('tbody tr');
		expect(rows).toHaveLength(2);
		expect(rows[0].textContent).toContain('vars.region');
		expect(rows[0].textContent).toContain('eu');
		expect(rows[1].textContent).toContain('********');
		expect(rows[1].textContent).toContain('secret');
	});

	it('creates in a drawer that posts key, value and the secret flag', async () => {
		const { container, getAllByRole } = setup([]);
		expect(container.querySelector('[role="dialog"]')).toBeNull();
		await fireEvent.click(getAllByRole('button', { name: /new variable/i })[0]);
		const dialog = container.querySelector('[role="dialog"]') as HTMLElement;
		const form = dialog.querySelector('form[action="?/put"]') as HTMLFormElement;
		expect(form.querySelector('[name="key"]')).toBeTruthy();
		expect(form.querySelector('[name="value"]')).toBeTruthy();
		expect((form.querySelector('[name="is_secret"]') as HTMLInputElement).value).toBe('false');
		expect(dialog.querySelector('button[type="submit"]')?.textContent?.trim()).toBe('Create');
	});

	it('keeps the typed value when Secret is flipped, in both directions', async () => {
		const { getByLabelText, container, getAllByRole } = setup([]);
		await fireEvent.click(getAllByRole('button', { name: /new variable/i })[0]);
		const form = container.querySelector('form[action="?/put"]') as HTMLFormElement;
		await fireEvent.input(getByLabelText('Value'), { target: { value: 'sk-live-1' } });
		await fireEvent.click(getByLabelText('Secret'));
		let value = form.querySelector('[name="value"]') as HTMLInputElement;
		expect(value.type).toBe('password');
		expect(value.value).toBe('sk-live-1');
		expect((form.querySelector('[name="is_secret"]') as HTMLInputElement).value).toBe('true');
		await fireEvent.click(getByLabelText('Secret'));
		value = form.querySelector('[name="value"]') as HTMLInputElement;
		expect(value.type).toBe('text');
		expect(value.value).toBe('sk-live-1');
	});

	it('keeps a value typed into the edit drawer when its Secret is flipped', async () => {
		const { getByLabelText, container } = setup();
		await fireEvent.click(getByLabelText('Edit region'));
		const form = container.querySelector('form[action="?/put"]') as HTMLFormElement;
		await fireEvent.input(form.querySelector('[name="value"]') as HTMLInputElement, { target: { value: 'us' } });
		await fireEvent.click(form.querySelector('[role="switch"]') as HTMLElement);
		const value = form.querySelector('[name="value"]') as HTMLInputElement;
		expect(value.type).toBe('password');
		expect(value.value).toBe('us');
		expect((form.querySelector('[name="is_secret"]') as HTMLInputElement).value).toBe('true');
	});

	it('edits a plain value in the drawer with the stored value filled in, and offers Save', async () => {
		const { getByLabelText, container } = setup();
		await fireEvent.click(getByLabelText('Edit region'));
		const dialog = container.querySelector('[role="dialog"]') as HTMLElement;
		const form = dialog.querySelector('form[action="?/put"]') as HTMLFormElement;
		expect((form.querySelector('[name="value"]') as HTMLInputElement).value).toBe('eu');
		expect((form.querySelector('[name="existing"]') as HTMLInputElement).value).toBe('true');
		expect((form.querySelector('[name="key"]') as HTMLInputElement).value).toBe('region');
		expect(dialog.querySelector('button[type="submit"]')?.textContent?.trim()).toBe('Save');
	});

	it('edits a secret with an empty write-only field and a hint', async () => {
		const { getByLabelText, container } = setup();
		await fireEvent.click(getByLabelText('Edit api_key'));
		const form = container.querySelector('form[action="?/put"]') as HTMLFormElement;
		const value = form.querySelector('[name="value"]') as HTMLInputElement;
		expect(value.value).toBe('');
		expect(value.type).toBe('password');
		expect(form.textContent).toContain('write-only');
	});

	it('closes the drawer once the write is saved', () => {
		const { container } = setup(variables, { saved: 'region' });
		expect(container.querySelector('[role="dialog"]')).toBeNull();
	});

	it('never posts a delete straight from the row', () => {
		const { container, getByLabelText } = setup();
		expect(getByLabelText('Delete region')).toBeTruthy();
		const form = container.querySelector('form[action="?/delete"]') as HTMLFormElement;
		expect((form.querySelector('[name="key"]') as HTMLInputElement).value).toBe('');
	});

	it('shows the action error', () => {
		const { container } = setup(variables, { error: 'value too long', key: 'region' });
		expect(container.textContent).toContain('value too long');
	});

	it('renders the not-enabled state when locked', () => {
		const { getByTestId } = setup([], null, true);
		expect(getByTestId('not-enabled')).toBeTruthy();
	});

	it('shows a failed load as an alert and not as an empty list', () => {
		const { container, queryByText } = setup([], null, false, 'Variables could not be read from the engine.');
		expect(container.textContent).toContain('Variables could not be read from the engine.');
		expect(queryByText('No variables yet')).toBeNull();
	});
});
