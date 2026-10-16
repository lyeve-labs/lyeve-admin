// @vitest-environment jsdom
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy: () => {} }) }));
const kit = vi.hoisted(() => ({ confirm: vi.fn(async () => true) }));
vi.mock('@lyeve-labs/ui-kit', async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	confirm: kit.confirm,
}));

/**
 * Press a row's delete, accept the question, and return its title and what
 * the hidden form held when it was sent. The value has to be in the form by
 * then, which is what waiting on the next render before sending is for.
 */
async function pressDelete(button: HTMLElement, field: string): Promise<{ title: string; sent: string }> {
	let sent = '';
	const spy = vi.spyOn(HTMLFormElement.prototype, 'requestSubmit').mockImplementation(function (this: HTMLFormElement) {
		sent = (this.querySelector(`input[name="${field}"]`) as HTMLInputElement | null)?.value ?? '';
	});
	kit.confirm.mockClear();
	await fireEvent.click(button);
	await vi.waitFor(() => expect(spy).toHaveBeenCalled());
	spy.mockRestore();
	return { title: String((kit.confirm.mock.calls[0] as unknown[] | undefined)?.[0] ?? ''), sent };
}


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

const props = (over: Record<string, unknown> = {}, form: unknown = null) => ({
	data: {
		gate: { state: 'ok' },
		schema: { ok: true, value: { roots: ROOTS, refused: null } },
		persisted: { ok: true, value: [] },
		...over,
	} as never,
	form: form as never,
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
		expect(container.textContent).toContain('Your role cannot open persisted queries');
		expect(queryByText('No persisted queries')).toBeNull();
		expect(queryByRole('button', { name: 'New persisted query' })).toBeNull();
	});

	it('offers the create from the first-run state', () => {
		const { getByText, getAllByRole } = render(GraphqlPage, { props: props() });
		expect(getByText('No persisted queries')).toBeTruthy();
		expect(getAllByRole('button', { name: 'New persisted query' })).toHaveLength(2);
	});
});

describe('the register drawer', () => {
	const drawerText = () => document.body.querySelector('form#persisted-form')?.textContent ?? '';
	const query = { query_hash: 'abc123', query: '{ posts { id } }', operation_name: 'Posts', description: '', enabled: true, auto_registered: false };

	it('shows a refused register inside the open drawer', async () => {
		const { getAllByRole, rerender } = render(GraphqlPage, { props: props() });
		await fireEvent.click(getAllByRole('button', { name: 'New persisted query' })[0]);
		await rerender(props({}, { action: 'register', error: 'The query could not be registered.' }));
		expect(drawerText()).toContain('The query could not be registered.');
	});

	it('shows a failed delete above the list and leaves a newly opened drawer clean', async () => {
		const { container, getByRole } = render(GraphqlPage, {
			props: props({ persisted: { ok: true, value: [query] } }, { action: 'delete', error: 'The query could not be deleted.' }),
		});
		expect(container.textContent).toContain('The query could not be deleted.');
		await fireEvent.click(getByRole('button', { name: 'New persisted query' }));
		expect(drawerText()).not.toContain('could not be deleted');
	});
});

describe('persisted query delete', () => {
	it('names the query and sends its hash', async () => {
		const query = { query_hash: 'abc123', query: '{ posts { id } }', operation_name: 'Posts', description: '', enabled: true, auto_registered: false };
		const { getByRole } = render(GraphqlPage, { props: props({ persisted: { ok: true, value: [query] } }) });
		const out = await pressDelete(getByRole('button', { name: 'Delete Posts' }), 'hash');
		expect(out.title).toBe('Delete persisted query Posts');
		expect(out.sent).toBe('abc123');
	});
});

describe('the endpoint table', () => {
	it('keeps each method and path on one line, so a narrow screen scrolls the table instead of breaking the path', () => {
		const { container } = render(GraphqlPage, { props: props() });
		const cells = [...container.querySelectorAll('td')].filter((td) =>
			/^(POST|GET) \//.test(td.textContent?.trim() ?? ''),
		);
		expect(cells).toHaveLength(2);
		for (const td of cells) expect(td.getAttribute('data-cell')).toBe('nowrap');
	});
});

describe('a persisted query list past one page', () => {
	const query = { query_hash: 'abc123def456', operation_name: 'Landing', query: '{ x }', description: '', enabled: true };

	it('says how many it cannot show', () => {
		const { container } = render(GraphqlPage, { props: props({ persisted: { ok: true, value: [query] }, persistedTotal: 340 }) });
		expect(container.textContent).toContain('Showing the first 1 of 340 persisted queries');
	});

	it('says nothing when the list is whole', () => {
		const { container } = render(GraphqlPage, { props: props({ persisted: { ok: true, value: [query] }, persistedTotal: 1 }) });
		expect(container.textContent).not.toContain('Showing the first');
	});
});

describe('layout on narrow and medium screens', () => {
	// With the endpoint cells held on one line, the notes beside them got 43px
	// on a phone and ran forty lines tall.
	it('gives each endpoint note a minimum width, so the table scrolls in its box', () => {
		const { getByText } = render(GraphqlPage, { props: props() });
		for (const text of [/A GET on the same path/, /WebSocket, the graphql-ws protocol/]) {
			expect((getByText(text).closest('td') as HTMLElement).className).toContain('min-w-48');
		}
	});

	// Three tables across at 1024px left the description column 55px wide.
	it('puts the three schema tables side by side only from the extra large breakpoint', () => {
		const { container } = render(GraphqlPage, { props: props() });
		const grid = nameCell(container, 'landing_page').closest('.grid') as HTMLElement;
		expect(grid.className).toContain('xl:grid-cols-3');
		expect(grid.className).not.toContain('lg:grid-cols-3');
	});
});
