// @vitest-environment jsdom
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ImportWizard from './ImportWizard.svelte';

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

const schemas = [{ name: 'order', fields: [{ name: 'placed_at', field_type: 'datetime' }] }];

const template = {
	id: 't1',
	name: 'Orders',
	content_type: 'order',
	field_mappings: [{ source_field: 'Placed', target_field: 'placed_at' }],
	created_at: '2026-10-01T00:00:00Z',
	updated_at: '2026-10-01T00:00:00Z',
};

describe('the import wizard', () => {
	it('takes a workbook and states the column and cell limits before the upload', () => {
		render(ImportWizard, { props: { open: true, schemas, onstarted: vi.fn() } });
		const text = document.body.textContent ?? '';
		expect(text).toContain('an Excel workbook (XLSX)');
		expect(text).toContain('1,024 columns');
		expect(text).toContain("cells, its header's width times its rows");
		expect((document.getElementById('import-file') as HTMLInputElement).accept).toContain('.xlsx');
	});

	it('offers the saved templates on the first step', () => {
		render(ImportWizard, { props: { open: true, schemas, templates: [template], onstarted: vi.fn() } });
		expect(screen.getByText('Mapping template')).toBeTruthy();
	});

	it('asks for no template when none is saved', () => {
		render(ImportWizard, { props: { open: true, schemas, onstarted: vi.fn() } });
		expect(screen.queryByText('Mapping template')).toBeNull();
	});

	it('offers every sheet of a workbook and reads the one chosen', async () => {
		const sent: Record<string, unknown>[] = [];
		const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
			const body = JSON.parse(String(init.body)) as Record<string, unknown>;
			sent.push(body);
			const columns = body.sheet === 'Returns' ? ['Returned'] : ['Placed'];
			return new Response(
				JSON.stringify({
					source_format: 'xlsx',
					source_name: 'orders.xlsx',
					columns,
					rows: [],
					total_rows: 0,
					errors: [],
					export: false,
					schemas: {},
					sheets: ['Orders', 'Returns'],
				}),
				{ status: 200, headers: { 'content-type': 'application/json' } },
			);
		});
		vi.stubGlobal('fetch', fetchMock);
		render(ImportWizard, { props: { open: true, schemas, onstarted: vi.fn() } });

		await fireEvent.click(screen.getByRole('radio', { name: 'From a web address' }));
		await fireEvent.input(document.getElementById('import-url') as HTMLInputElement, {
			target: { value: 'https://example.com/orders.xlsx' },
		});
		await fireEvent.click(screen.getByRole('button', { name: 'Read the file' }));
		await waitFor(() => expect(document.body.textContent).toContain('The workbook holds 2 sheets'));
		expect(sent[0].sheet).toBeUndefined();

		await fireEvent.click(document.getElementById('import-sheet-read') as HTMLElement);
		await fireEvent.click(screen.getByRole('option', { name: 'Returns' }));
		await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
		expect(sent[1].sheet).toBe('Returns');
	});

	it('offers no sheet choice for a workbook of one sheet', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(
						JSON.stringify({
							source_format: 'xlsx',
							source_name: 'orders.xlsx',
							columns: ['Placed'],
							rows: [],
							total_rows: 0,
							errors: [],
							export: false,
							schemas: {},
							sheets: ['Orders'],
						}),
						{ status: 200, headers: { 'content-type': 'application/json' } },
					),
			),
		);
		render(ImportWizard, { props: { open: true, schemas, onstarted: vi.fn() } });
		await fireEvent.click(screen.getByRole('radio', { name: 'From a web address' }));
		await fireEvent.input(document.getElementById('import-url') as HTMLInputElement, {
			target: { value: 'https://example.com/orders.xlsx' },
		});
		await fireEvent.click(screen.getByRole('button', { name: 'Read the file' }));
		await waitFor(() => expect(document.body.textContent).toContain('orders.xlsx'));
		expect(document.getElementById('import-sheet-read')).toBeNull();
	});

	it('says what to do about a sheet past the column bound, by its code', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(
						JSON.stringify({ error: 'failed to parse file: reworded', code: 'bulk_import.too_many_columns' }),
						{ status: 400, headers: { 'content-type': 'application/json' } },
					),
			),
		);
		render(ImportWizard, { props: { open: true, schemas, onstarted: vi.fn() } });
		await fireEvent.click(screen.getByRole('radio', { name: 'From a web address' }));
		await fireEvent.input(document.getElementById('import-url') as HTMLInputElement, {
			target: { value: 'https://example.com/orders.xlsx' },
		});
		await fireEvent.click(screen.getByRole('button', { name: 'Read the file' }));
		await waitFor(() => expect(document.body.textContent).toContain('Delete the columns the import does not need'));
	});
});
