// @vitest-environment jsdom
import { fireEvent, render } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import JsonFieldEditor, { cellValue, pairsOf, parseError, textOf } from './JsonFieldEditor.svelte';

describe('pairsOf', () => {
	it('reads a flat object as pairs', () => {
		expect(pairsOf('{"a":"x","n":3,"b":true,"z":null}')).toEqual([
			{ key: 'a', value: 'x' },
			{ key: 'n', value: '3' },
			{ key: 'b', value: 'true' },
			{ key: 'z', value: 'null' },
		]);
	});

	it('refuses what pairs cannot hold without changing it', () => {
		// A nested value, an array or a scalar would come back different on save.
		expect(pairsOf('{"a":{"b":1}}')).toBeNull();
		expect(pairsOf('[1,2]')).toBeNull();
		expect(pairsOf('"text"')).toBeNull();
		expect(pairsOf('{not json')).toBeNull();
	});

	it('reads empty text as no pairs', () => {
		expect(pairsOf('  ')).toEqual([]);
	});
});

describe('cellValue and textOf', () => {
	it('keeps numbers, booleans and null typed and everything else as text', () => {
		expect(cellValue('3')).toBe(3);
		expect(cellValue('-1.5e3')).toBe(-1500);
		expect(cellValue('true')).toBe(true);
		expect(cellValue('null')).toBeNull();
		expect(cellValue('03')).toBe('03');
		expect(cellValue('hello')).toBe('hello');
	});

	it('writes the pairs as a JSON object and leaves out a pair with no key', () => {
		const text = textOf([
			{ key: 'a', value: '1' },
			{ key: '', value: 'ignored' },
			{ key: 'b', value: 'two' },
		]);
		expect(JSON.parse(text)).toEqual({ a: 1, b: 'two' });
	});

	it('round-trips a flat object', () => {
		const doc = { name: 'x', count: 2, on: false };
		const pairs = pairsOf(JSON.stringify(doc));
		expect(pairs).not.toBeNull();
		expect(JSON.parse(textOf(pairs ?? []))).toEqual(doc);
	});
});

describe('parseError', () => {
	it('names the parse failure and says nothing for valid or empty text', () => {
		expect(parseError('{')).toBeTruthy();
		expect(parseError('{"a":1}')).toBeNull();
		expect(parseError('')).toBeNull();
	});
});

describe('JsonFieldEditor', () => {
	it('opens a flat object as keys and values and shows what is saved', () => {
		const { container, getByTestId } = render(JsonFieldEditor, { props: { value: '{"a":"x"}' } });
		const inputs = container.querySelectorAll('input');
		expect((inputs[0] as HTMLInputElement).value).toBe('a');
		expect((inputs[1] as HTMLInputElement).value).toBe('x');
		expect(JSON.parse(getByTestId('json-preview').textContent ?? '')).toEqual({ a: 'x' });
	});

	it('opens a nested document as JSON text', () => {
		const { container } = render(JsonFieldEditor, { props: { value: '{"a":{"b":1}}' } });
		expect(container.querySelector('textarea')).toBeTruthy();
		expect(container.textContent).toContain('stays as JSON');
	});

	it('reports invalid JSON while it is typed', async () => {
		const { container } = render(JsonFieldEditor, { props: { value: '[1]' } });
		const area = container.querySelector('textarea') as HTMLTextAreaElement;
		await fireEvent.input(area, { target: { value: '{"a":' } });
		expect(container.textContent).toContain('Not valid JSON');
	});
});
