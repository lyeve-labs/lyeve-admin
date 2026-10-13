// @vitest-environment jsdom
import { render, cleanup } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy: () => {} }) }));

import GraphqlPage from './+page.svelte';

afterEach(cleanup);

const ROOTS = {
	query: [
		{ name: 'landing_page', description: 'A page of landing_page entries.', args: ['offset', 'locale', 'where', 'limit'] },
		{ name: 'health', description: 'Liveness.', args: [] },
	],
	mutation: [{ name: 'updateLandingPage', description: 'Updates one entry.', args: ['id', 'input'] }],
	subscription: [],
};

const props = (over: Record<string, unknown> = {}) => ({
	data: {
		gate: { state: 'ok' },
		schema: { ok: true, value: { roots: ROOTS, refused: null } },
		persisted: { ok: true, value: [] },
		...over,
	} as never,
	form: null as never,
});

function nameCell(container: HTMLElement, name: string): HTMLTableCellElement {
	const cell = [...container.querySelectorAll('td')].find((td) => td.textContent?.trim().startsWith(name));
	if (!cell) throw new Error(`no cell for ${name}`);
	return cell;
}

/*
 * The kit's tables wrap a narrow column anywhere, so a field name in the
 * three-column schema grid broke mid-word. Every identifier is held whole,
 * and only the gaps between arguments may break.
 */
describe('Schema field names', () => {
	it('holds each name and argument whole', () => {
		const { container } = render(GraphqlPage, { props: props() });
		const cell = nameCell(container, 'landing_page');

		const whole = [...cell.querySelectorAll('.whitespace-nowrap')].map((el) => el.textContent);
		expect(whole).toEqual(['landing_page', '(offset,', 'locale,', 'where,', 'limit)']);
		expect(cell.textContent?.replace(/\s+/g, ' ').trim()).toBe('landing_page(offset, locale, where, limit)');
	});

	it('holds a name without arguments whole', () => {
		const { container } = render(GraphqlPage, { props: props() });
		const cell = nameCell(container, 'health');

		expect([...cell.querySelectorAll('.whitespace-nowrap')].map((el) => el.textContent)).toEqual(['health']);
		expect(cell.textContent?.trim()).toBe('health');
	});

	it('closes a one-argument list on the argument', () => {
		const { container } = render(GraphqlPage, {
			props: props({
				schema: { ok: true, value: { roots: { query: [{ name: 'post_one', description: '', args: ['id'] }], mutation: [], subscription: [] }, refused: null } },
			}),
		});

		const cell = nameCell(container, 'post_one');
		expect([...cell.querySelectorAll('.whitespace-nowrap')].map((el) => el.textContent)).toEqual(['post_one', '(id)']);
	});
});

describe('Persisted queries', () => {
	it('says a failed read failed rather than that there are none, and offers no create', () => {
		const { container, queryByText, queryByRole } = render(GraphqlPage, {
			props: props({ persisted: { ok: false, gate: { state: 'forbidden' } } }),
		});
		expect(container.textContent).toContain('Your role cannot open Persisted queries');
		expect(queryByText('No persisted queries')).toBeNull();
		expect(queryByRole('button', { name: 'New persisted query' })).toBeNull();
	});

	it('offers the create from the first-run state', () => {
		const { getByText, getAllByRole } = render(GraphqlPage, { props: props() });
		expect(getByText('No persisted queries')).toBeTruthy();
		expect(getAllByRole('button', { name: 'New persisted query' })).toHaveLength(2);
	});
});
