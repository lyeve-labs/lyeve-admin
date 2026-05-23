// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import ListToolbar from './ListToolbar.svelte';
import Search from './list-toolbar-search.test.svelte';
import Filters from './list-toolbar-filters.test.svelte';

afterEach(cleanup);

// A component stands in for a snippet: both are called the same way by
// {@render}, and a test cannot declare a snippet outside a .svelte file.
const props = (extra: Record<string, unknown> = {}) =>
	({ label: 'Filter things', search: Search, filters: Filters, ...extra }) as never;

/*
 * The slot order is the contract: search first, filters after it and
 * pushed to the trailing edge, and the search takes the whole first row on a
 * narrow screen so the filters wrap below it.
 */
describe('ListToolbar', () => {
	it('is a named toolbar', () => {
		const { container } = render(ListToolbar, { props: props() });
		const bar = container.querySelector('[role="toolbar"]');
		expect(bar?.getAttribute('aria-label')).toBe('Filter things');
	});

	it('puts the search before the filters, and the filters at the trailing edge', () => {
		const { container } = render(ListToolbar, { props: props() });
		const search = container.querySelector('[data-slot="search"]')!;
		const filters = container.querySelector('[data-slot="filters"]')!;
		expect(search && filters).toBeTruthy();
		expect(search.compareDocumentPosition(filters) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
		expect(filters.parentElement?.className).toContain('ms-auto');
	});

	it('gives the search the whole first row below md', () => {
		const { container } = render(ListToolbar, { props: props() });
		const search = container.querySelector('[data-slot="search"]')!;
		expect(search.className).toContain('w-full');
		expect(search.className).toContain('md:flex-1');
	});

	/*
	 * Every panel the kit paints is absolutely positioned, so a scroll
	 * container anywhere above one clips it. The scroll belongs to the control
	 * that needs it.
	 */
	it('makes no scroll container of the filter row', () => {
		const { container } = render(ListToolbar, { props: props() });
		const filters = container.querySelector('[data-slot="filters"]')!;
		expect(filters.className).not.toMatch(/(?:^|\s)overflow-(?:x-|y-)?(?:auto|scroll|hidden)/);
	});

	it('leaves the sideways scroll to the segmented control', () => {
		const { container } = render(ListToolbar, { props: props() });
		const filters = container.querySelector('[data-slot="filters"]')!;
		expect(filters.className).toContain('[&_[role=radiogroup]]:overflow-x-auto');
		// Select marks its option groups role="group" and DateTimePicker marks
		// the control that opens a calendar, so the group selector must not
		// scroll or it clips the panels it would be protecting.
		expect(filters.className).not.toContain('[&_[role=group]]:overflow-x-auto');
	});

	it('renders no trailing group when there are no filters', () => {
		const { container } = render(ListToolbar, { props: props({ filters: undefined }) });
		expect(container.querySelector('[data-slot="filters"]')).toBeNull();
		expect(container.querySelector('[data-slot="search"]')).not.toBeNull();
	});
});
