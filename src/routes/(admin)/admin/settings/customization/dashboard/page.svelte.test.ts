// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import EditorPage from './+page.svelte';

afterEach(cleanup);

function mount(widgets: unknown[] = [], custom = false, running: string[] = ['content', 'media', 'audit']) {
	render(EditorPage, {
		props: {
			data: {
				layout: { entitled: true, custom, widgets, updated_at: custom ? '2026-09-26T10:00:00Z' : null },
				schemas: ['posts', 'authors'],
				plugins: { state: 'named', running, withheld: [] },
				user: { roles: ['admin'] },
			},
			form: null,
		} as never,
	});
}

describe('dashboard editor page', () => {
	it('is marked beta and says the stock dashboard is showing', () => {
		mount();
		expect(screen.getByText('Beta')).toBeTruthy();
		expect(screen.getByTestId('layout-state').textContent).toMatch(/stock dashboard/);
	});

	// A stored widget omits its empty fields, and binding a kit input to
	// undefined throws during the mount.
	it('opens a stored layout whose widgets omit their empty fields', () => {
		expect(() =>
			mount(
				[
					{ id: 'a', type: 'latest_entries', limit: 5 },
					{ id: 'b', type: 'text', body: 'Hi' },
					{ id: 'c', type: 'links', links: [{ label: 'Docs', url: 'https://d.e' }] },
				],
				true,
			),
		).not.toThrow();
		expect(screen.getAllByLabelText('Heading')).toHaveLength(3);
		expect(screen.getByTestId('layout-state').textContent).toMatch(/3\s+widgets/);
	});

	it('offers only the widgets whose plugin runs', () => {
		mount();
		expect(screen.getByRole('button', { name: 'Add latest entries' })).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'Add API usage' })).toBeNull();
	});

	it('adds, reorders and removes widgets', async () => {
		mount();
		await fireEvent.click(screen.getByRole('button', { name: 'Add media usage' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Add text' }));
		expect(screen.getByText('1. Media usage')).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: 'Move widget 2 up' }));
		expect(screen.getByText('1. Text')).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: 'Remove widget 1' }));
		expect(screen.queryByText('1. Text')).toBeNull();
		expect(screen.getByText('1. Media usage')).toBeTruthy();
	});

	it('starts from a layout close to the stock dashboard', async () => {
		mount();
		await fireEvent.click(screen.getByRole('button', { name: /Start from the stock layout/ }));
		expect(screen.getByText('1. Entry counts')).toBeTruthy();
		expect(screen.getAllByRole('button', { name: /^Remove widget/ }).length).toBeGreaterThan(3);
	});
});
