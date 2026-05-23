import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@lyeve-labs/client';
import {
	emptyTransform,
	formatFromName,
	lookupMap,
	parseRefusalHint,
	previewImport,
	transformDraft,
	transformFields,
} from './bulk-import';
import { refusalOf } from './refusal';

describe('transformFields', () => {
	it('sends nothing for a cell kept as it is', () => {
		expect(transformFields(emptyTransform())).toEqual({});
	});

	it('names a text transform with no options', () => {
		expect(transformFields({ ...emptyTransform(), transform: 'trim' })).toEqual({ transform: 'trim' });
	});

	it('needs a layout for a date and leaves an empty output layout out', () => {
		expect(transformFields({ ...emptyTransform(), transform: 'date' })).toMatch(/layout/);
		expect(transformFields({ ...emptyTransform(), transform: 'date', layout: '02/01/2006' })).toEqual({
			transform: 'date',
			transform_options: { layout: '02/01/2006' },
		});
	});

	it('splits on the separator given', () => {
		expect(transformFields({ ...emptyTransform(), transform: 'split', separator: ';' })).toEqual({
			transform: 'split',
			transform_options: { separator: ';' },
		});
		expect(transformFields({ ...emptyTransform(), transform: 'split', separator: '' })).toMatch(/separator/);
	});

	// No default means a value the map lacks rejects the row, so an empty
	// field must not be sent as an empty-string default.
	it('sends the lookup map and a default only when one was given', () => {
		const d = { ...emptyTransform(), transform: 'lookup' as const, lookup: 'NY = New York\nCA=California\nbroken' };
		expect(transformFields(d)).toEqual({
			transform: 'lookup',
			transform_options: { map: { NY: 'New York', CA: 'California' } },
		});
		expect(transformFields({ ...d, fallback: 'Elsewhere' })).toEqual({
			transform: 'lookup',
			transform_options: { map: { NY: 'New York', CA: 'California' }, default: 'Elsewhere' },
		});
		expect(transformFields({ ...emptyTransform(), transform: 'lookup', lookup: '' })).toMatch(/at least one/);
	});

	it('round trips a stored mapping through the draft', () => {
		const stored = {
			transform: 'lookup' as const,
			transform_options: { map: { a: 'b' }, default: 'z' },
		};
		expect(transformFields(transformDraft(stored))).toEqual(stored);
	});
});

describe('lookupMap', () => {
	it('keeps a value holding an equals sign after the first', () => {
		expect(lookupMap('k = a=b')).toEqual({ k: 'a=b' });
	});
});

describe('the file limits', () => {
	it('reads an XLSX file name as a workbook', () => {
		expect(formatFromName('Orders.XLSX')).toBe('xlsx');
	});

	it('says what to do about each refusal to read a file', () => {
		expect(parseRefusalHint('failed to parse file: reworded', 'bulk_import.too_many_columns')).toMatch(/columns/);
		expect(parseRefusalHint('failed to parse file: reworded', 'bulk_import.too_many_cells')).toMatch(/header width times the rows/);
		expect(parseRefusalHint('failed to parse file: the sheet has more than 1024 columns')).toBe('');
		expect(parseRefusalHint('failed to parse file: the workbook has no sheet named "Data"')).toMatch(/case included/);
		expect(parseRefusalHint('something else')).toBe('');
	});
});

describe('postImport', () => {
	// The refusal keeps its body, so the wizard renders it with the plugin's
	// own words rather than a bare status.
	it('throws a license refusal the refusal notice can read', async () => {
		const fetchFn = vi.fn(
			async () =>
				new Response(JSON.stringify({ error: 'payment_required', plugin: 'example', feature: 'feature:example_feature' }), {
					status: 402,
				}),
		) as unknown as typeof fetch;
		const err = await previewImport(fetchFn, { file_data: 'eA==' }).catch((e: unknown) => e);
		expect(err).toBeInstanceOf(ApiError);
		expect(refusalOf(err)).toMatchObject({ kind: 'feature', feature: 'example-feature' });
	});

	it('keeps the plugin sentence for a file it would not read', async () => {
		const fetchFn = vi.fn(
			async () => new Response(JSON.stringify({ error: 'failed to parse file: the sheet has more than 1024 columns' }), { status: 400 }),
		) as unknown as typeof fetch;
		const err = (await previewImport(fetchFn, { file_data: 'eA==' }).catch((e: unknown) => e)) as Error;
		expect(err.message).toBe('failed to parse file: the sheet has more than 1024 columns');
	});
});
