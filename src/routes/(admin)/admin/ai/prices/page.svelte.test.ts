// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Page from './+page.svelte';
import { fixturePrice, fixtureSettings } from '$lib/components/ai/fixtures';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));

afterEach(cleanup);

function setup(overrides: Record<string, unknown> = {}, form: unknown = null) {
	return render(Page, {
		props: {
			data: { gate: { state: 'ok' }, prices: [fixturePrice], aiSettings: fixtureSettings, aiLayoutGate: { state: 'ok' }, isSuperAdmin: true, ...overrides },
			form,
		} as never,
	});
}

describe('AI prices page', () => {
	it('edits a row in the drawer, keyed by its kind and model, and offers Save', async () => {
		const { container, getByLabelText } = setup();
		const row = container.querySelector('tbody tr') as HTMLElement;
		expect(row.textContent).toContain('OpenAI');
		expect(row.textContent).toContain('gpt-4o');
		await fireEvent.click(getByLabelText('Edit price for gpt-4o'));
		const dialog = container.querySelector('[role="dialog"]') as HTMLElement;
		const form = dialog.querySelector('form[action="?/save"]') as HTMLFormElement;
		expect((form.querySelector('input[name="kind"]') as HTMLInputElement).value).toBe('openai');
		expect((form.querySelector('input[name="model"]') as HTMLInputElement).value).toBe('gpt-4o');
		expect((form.querySelector('input[name="output_per_1k"]') as HTMLInputElement).valueAsNumber).toBe(0.01);
		expect(dialog.querySelector('button[type="submit"]')?.textContent?.trim()).toBe('Save');
	});

	it('creates in the drawer from the header, and offers Create', async () => {
		const { container, getAllByRole } = setup();
		await fireEvent.click(getAllByRole('button', { name: /new price/i })[0]);
		const dialog = container.querySelector('[role="dialog"]') as HTMLElement;
		expect(dialog.querySelector('input[name="model"]')).toBeTruthy();
		expect(dialog.querySelector('button[type="submit"]')?.textContent?.trim()).toBe('Create');
	});

	it('asks before it deletes, then posts the row key', async () => {
		const { container, getByLabelText } = setup();
		const form = container.querySelector('form[action="?/delete"]') as HTMLFormElement;
		expect(container.querySelector('tbody form')).toBeNull();
		expect((form.querySelector('input[name="model"]') as HTMLInputElement).value).toBe('');
		expect(getByLabelText('Delete price for gpt-4o')).toBeTruthy();
	});

	it('reads only for a tenant admin', () => {
		const { container, queryByRole } = setup({ isSuperAdmin: false });
		expect(container.querySelector('tbody button')).toBeNull();
		expect(container.querySelector('tbody tr')?.textContent).toContain('$0.0025');
		expect(queryByRole('button', { name: /new price/i })).toBeNull();
	});

	it('matches a saved result to its row', () => {
		const saved = setup({}, { key: 'openai/gpt-4o', saved: true });
		expect(saved.getByRole('status').textContent).toContain('Saved.');
	});

	it('shows a write error on the page once the drawer is shut', () => {
		const { getByText } = setup({}, { key: 'openai/', error: 'Model is required.' });
		expect(getByText('Model is required.')).toBeTruthy();
	});

	it('paints the empty state and the off state', () => {
		const empty = setup({ prices: [] });
		expect(empty.getByText('No prices yet')).toBeTruthy();
		cleanup();
		const off = setup({ gate: { state: 'off' }, prices: [] });
		expect(off.getByText('AI is switched off for this tenant')).toBeTruthy();
		expect(off.queryByRole('button', { name: /new price/i })).toBeNull();
	});
});
