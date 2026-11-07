// @vitest-environment jsdom
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

// enhance keeps each form's submit handler, so a case can run the one a
// row's delete would run.
const forms = vi.hoisted(() => ({ submits: new Map<HTMLFormElement, (input: unknown) => unknown>() }));
vi.mock('$app/forms', () => ({
	enhance: (node: HTMLFormElement, submit: (input: unknown) => unknown) => {
		forms.submits.set(node, submit);
		return { destroy: () => forms.submits.delete(node) };
	},
}));
const kit = vi.hoisted(() => ({ confirm: vi.fn(async () => true) }));
vi.mock('@lyeve-labs/ui-kit', async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	confirm: kit.confirm,
}));

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
		persistedTotal: 0,
		limit: 50,
		offset: 0,
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
		expect(queryByText('No persisted queries yet')).toBeNull();
		expect(queryByRole('button', { name: 'New persisted query' })).toBeNull();
	});

	it('offers the create from the first-run state', () => {
		const { getByText, getAllByRole } = render(GraphqlPage, { props: props() });
		expect(getByText('No persisted queries yet')).toBeTruthy();
		expect(getAllByRole('button', { name: 'New persisted query' })).toHaveLength(2);
	});
});

describe('the register drawer', () => {
	const drawerText = () => document.body.querySelector('form#persisted-form')?.textContent ?? '';
	const query = { query_hash: 'abc123', query: '{ posts { id } }', operation_name: 'Posts', description: '', enabled: true, auto_registered: false };

	it('shows a refused register inside the open drawer', async () => {
		const { getAllByRole, rerender } = render(GraphqlPage, { props: props() });
		await fireEvent.click(getAllByRole('button', { name: 'New persisted query' })[0]);
		await rerender(props({}, { action: 'register', error: 'Could not register the query. Try again.' }));
		expect(drawerText()).toContain('Could not register the query. Try again.');
	});

	it('shows a failed delete above the list and leaves a newly opened drawer clean', async () => {
		const failed = 'Could not delete the query. Try again.';
		const { container, getByRole } = render(GraphqlPage, {
			props: props({ persisted: { ok: true, value: [query] } }, { action: 'delete', error: failed }),
		});
		expect(container.textContent).toContain(failed);
		await fireEvent.click(getByRole('button', { name: 'New persisted query' }));
		expect(drawerText()).not.toContain(failed);
	});
});

describe('persisted query delete', () => {
	it('names the query and sends its hash', async () => {
		const query = { query_hash: 'abc123', query: '{ posts { id } }', operation_name: 'Posts', description: '', enabled: true, auto_registered: false };
		const { getByRole } = render(GraphqlPage, { props: props({ persisted: { ok: true, value: [query] } }) });
		const form = getByRole('button', { name: 'Delete Posts' }).closest('form') as HTMLFormElement;
		expect(new FormData(form).get('hash')).toBe('abc123');
		await forms.submits.get(form)?.({ cancel: vi.fn() });
		expect(kit.confirm).toHaveBeenCalledWith(
			'Delete persisted query Posts?',
			'Clients that send only its hash will be refused.',
			{ confirmLabel: 'Delete' },
		);
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

	it('pages through the rest rather than leaving them out', () => {
		const { container } = render(GraphqlPage, { props: props({ persisted: { ok: true, value: [query] }, persistedTotal: 340 }) });
		const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));
		expect(hrefs).toContain('/admin/settings/graphql?limit=50&offset=50');
		expect(container.textContent).not.toContain('Showing the first');
	});

	it('offers no other page when the list is whole', () => {
		const { container } = render(GraphqlPage, { props: props({ persisted: { ok: true, value: [query] }, persistedTotal: 1 }) });
		const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href') ?? '');
		expect(hrefs.filter((h) => h.includes('offset='))).toEqual([]);
	});
});

describe('layout on narrow and medium screens', () => {
	// With the endpoint cells held on one line, the notes beside them got 43px
	// on a phone and ran forty lines tall.
	it('gives each endpoint note a minimum width, so the table scrolls in its box', () => {
		const { getByText } = render(GraphqlPage, { props: props() });
		for (const text of [/A GET on the same path/, /WebSocket with the graphql-ws protocol/]) {
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
