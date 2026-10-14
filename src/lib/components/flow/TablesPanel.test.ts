// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

import TablesPanel from './TablesPanel.svelte';

afterEach(cleanup);

const customers = { name: 'customers', columns: [{ name: 'email', type: 'text' }, { name: 'id', type: 'uuid' }] };
const orders = { name: 'orders', columns: [{ name: 'total', type: 'numeric' }] };

function setup(tables: Record<string, unknown>, onretry?: () => void) {
	const oninsert = vi.fn();
	const result = render(TablesPanel, { props: { tables: tables as never, oninsert, onretry } });
	return { ...result, oninsert };
}

describe('TablesPanel', () => {
	it('inserts a table name and a column name at the cursor', async () => {
		const { oninsert } = setup({ status: 'ready', tables: [customers, orders] });
		await fireEvent.click(screen.getByRole('button', { name: /^customers/ }));
		await fireEvent.click(screen.getByRole('button', { name: 'Insert customers' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Insert email' }));
		expect(oninsert.mock.calls).toEqual([['customers'], ['email']]);
	});

	it('filters by a table or a column name', async () => {
		setup({ status: 'ready', tables: [customers, orders] });
		await fireEvent.input(screen.getByPlaceholderText('Filter tables'), { target: { value: 'total' } });
		expect(screen.queryByRole('button', { name: /^customers/ })).toBeNull();
		expect(screen.getByRole('button', { name: /^orders/ })).toBeTruthy();
		await fireEvent.input(screen.getByPlaceholderText('Filter tables'), { target: { value: 'nothing' } });
		expect(screen.getByText('No table matches.')).toBeTruthy();
	});

	it('draws the first hundred matches and says how many more there are', () => {
		const many = Array.from({ length: 130 }, (_, i) => ({ name: `t${i}`, columns: [] }));
		setup({ status: 'ready', tables: many });
		expect(screen.getByText('30 more. Narrow the filter to see them.')).toBeTruthy();
		expect(screen.queryByRole('button', { name: /^t129/ })).toBeNull();
	});

	it('says why the tables could not be listed and offers a retry', async () => {
		const onretry = vi.fn();
		setup({ status: 'error', tables: [], message: 'permission denied for schema public' }, onretry);
		expect(screen.getByText('permission denied for schema public')).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: /Retry/ }));
		expect(onretry).toHaveBeenCalledTimes(1);
	});

	it('tells an empty datasource apart from one not yet chosen', () => {
		setup({ status: 'ready', tables: [] });
		expect(screen.getByText('The datasource has no tables the engine can read.')).toBeTruthy();
		cleanup();
		setup({ status: 'idle', tables: [] });
		expect(screen.getByText('Choose a SQL datasource to list its tables.')).toBeTruthy();
	});
});
