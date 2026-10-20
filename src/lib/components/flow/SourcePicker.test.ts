// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

import SourcePicker from './SourcePicker.svelte';

afterEach(cleanup);

const options = [
	{ value: 'posts', label: 'posts' },
	{ value: 'orders', label: 'orders' },
];

function setup(props: Record<string, unknown>) {
	const onchange = vi.fn();
	const result = render(SourcePicker, { props: { id: 'src', label: 'Schema', options, value: '', onchange, ...props } as never });
	return { ...result, onchange };
}

async function pick(label: string) {
	await fireEvent.click(document.getElementById('src') as HTMLElement);
	await fireEvent.click(screen.getByRole('option', { name: label }));
}

describe('SourcePicker', () => {
	it('hands back the row a reader picks', async () => {
		const { onchange } = setup({});
		await pick('orders');
		expect(onchange).toHaveBeenCalledWith('orders');
	});

	it('keeps a value the rows do not know visible as typed text', () => {
		setup({ value: '{{ trigger.query.schema }}' });
		expect((screen.getByLabelText('Schema value') as HTMLInputElement).value).toBe('{{ trigger.query.schema }}');
	});

	it('opens a free-text field when a reader asks for a custom value, and hands back what is typed', async () => {
		const { onchange } = setup({ value: 'posts' });
		expect(screen.queryByLabelText('Schema value')).toBeNull();
		await pick('Custom value or expression');
		const field = screen.getByLabelText('Schema value');
		await fireEvent.input(field, { target: { value: '{{ trigger.body.kind }}' } });
		expect(onchange).toHaveBeenLastCalledWith('{{ trigger.body.kind }}');
	});

	it('takes typed text and says why when there is nothing to choose from', async () => {
		const { onchange } = setup({ options: [], emptyHint: 'No schema exists yet.' });
		expect(screen.getByText('No schema exists yet.')).toBeTruthy();
		await fireEvent.input(screen.getByLabelText(/Schema/), { target: { value: 'posts' } });
		expect(onchange).toHaveBeenLastCalledWith('posts');
	});
});
