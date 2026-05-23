// @vitest-environment jsdom
import { render, screen, cleanup, fireEvent } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const nav = vi.hoisted(() => ({
	goto: vi.fn(async (_url: string, _opts?: Record<string, unknown>) => {}),
}));
vi.mock('$app/navigation', () => nav);
vi.mock('$app/forms', () => ({ enhance: () => ({ destroy: () => {} }) }));

import ContentListPage from './+page.svelte';
import type { PageData } from './$types';

afterEach(cleanup);

function items(count: number, from = 0) {
	return Array.from({ length: count }, (_, i) => ({
		id: `entry-${from + i}-0000-0000-0000`,
		created_at: '2026-01-01T00:00:00Z',
		updated_at: '2026-01-02T00:00:00Z',
		data: { title: `Entry ${from + i}`, _status: 'published' } as Record<string, unknown>,
	}));
}

/**
 * The page reads none of the layout data (user, entitlements), so the fixture
 * carries only what this page renders and is asserted against PageData once.
 */
function data(overrides: Record<string, unknown> = {}): PageData {
	return {
		schemas: [{ name: 'posts', display_name: 'Posts' }],
		schemaDef: {
			name: 'posts',
			display_name: 'Posts',
			fields: [{ name: 'title', field_type: 'string', system: false }],
			with_draft_publish: false,
			with_updated_at: false,
		},
		items: items(100),
		activeSchema: 'posts',
		limit: 100,
		offset: 0,
		total: 4000,
		...overrides,
	} as unknown as PageData;
}

// The length of the page is not the size of the collection. The count comes
// from the envelope total, stated once by Pagination.
describe('content listing states the collection total', () => {
	it('names the way back to Content', () => {
		render(ContentListPage, { props: { data: data(), form: null } });

		// The sidebar cannot name this page: it marks Content, and Content is
		// the collection index rather than this page.
		// The shell's back link leads the row and the breadcrumb follows it, so
		// Content is named once, as the way back. The trail starts after it.
		const links = screen.getAllByRole('link', { name: 'Content' });
		expect(links).toHaveLength(1);
		const [back] = links;
		expect(back.getAttribute('data-testid')).toBe('page-back');
		expect(back.getAttribute('href')).toBe('/admin/content');
		const crumb = document.querySelector('nav[aria-label]');
		expect(crumb, 'the breadcrumb is missing').not.toBeNull();
		expect(crumb?.textContent).toContain('Posts');
		expect(crumb?.textContent).not.toContain('Content');
	});

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('reports the total, not the size of the page on screen', () => {
		render(ContentListPage, { props: { data: data(), form: null } });

		// Grouped, because the pager sits under a table that groups its own
		// figures and a screen that prints the same kind of number two ways
		// reads as two different measurements.
		expect(screen.getByText('1 to 100 of 4,000')).toBeTruthy();
	});

	it('states the count in exactly one place', () => {
		render(ContentListPage, { props: { data: data(), form: null } });

		expect(screen.queryByText(/\d+\s+entries/)).toBeNull();
	});

	it('offers a page button per page of the collection, not just prev and next', () => {
		render(ContentListPage, { props: { data: data(), form: null } });

		expect(screen.getByRole('button', { name: '40' })).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Next page' })).toBeTruthy();
	});

	it('disables the previous button on the first page', () => {
		render(ContentListPage, { props: { data: data(), form: null } });

		const prev = screen.getByRole('button', { name: 'Previous page' }) as HTMLButtonElement;
		expect(prev.disabled).toBe(true);
	});
});

// An offset arrives in the URL and need not sit on a page boundary.
describe('content listing derives the page from the offset', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('floors an offset that is not a multiple of the limit onto its page', () => {
		render(ContentListPage, {
			props: { data: data({ offset: 150, items: items(100, 150) }), form: null },
		});

		const current = screen.getByRole('button', { current: 'page' });
		expect(current.textContent?.trim()).toBe('2');
	});

	it('marks the last page current at the final offset', () => {
		render(ContentListPage, {
			props: { data: data({ offset: 3900, items: items(100, 3900) }), form: null },
		});

		const current = screen.getByRole('button', { current: 'page' });
		expect(current.textContent?.trim()).toBe('40');
	});

	it('navigates by querystring so the page is linkable', async () => {
		render(ContentListPage, {
			props: { data: data({ offset: 150, items: items(100, 150) }), form: null },
		});

		await fireEvent.click(screen.getByRole('button', { name: '3' }));

		expect(nav.goto).toHaveBeenCalledOnce();
		const target = new URL(nav.goto.mock.calls[0][0], 'http://localhost');
		expect(target.pathname).toBe('/admin/content/posts');
		expect(target.searchParams.get('offset')).toBe('200');
		expect(target.searchParams.get('limit')).toBe('100');
	});
});

describe('content listing with no entries', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('shows the empty state and no pager', () => {
		render(ContentListPage, { props: { data: data({ items: [], total: 0 }), form: null } });

		expect(screen.getByText('No entries yet')).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'Next page' })).toBeNull();
	});
});

// The table heads a column ACTIONS. Whatever is under it has to be under it
// for everyone, not only for a pointer that happens to cross the row.
describe('the actions column holds its control', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('renders the row action for every row', () => {
		render(ContentListPage, { props: { data: data({ items: items(3) }), form: null } });

		for (const n of [0, 1, 2]) {
			expect(screen.getByRole('button', { name: `Delete Entry ${n}` })).toBeTruthy();
		}
	});

	it('does not hide the row action until the row is hovered', () => {
		// A control in the document but painted at zero opacity leaves the
		// column reading as empty under a heading that promises an action. The
		// class is the subject here because the class is what would hide it.
		render(ContentListPage, { props: { data: data({ items: items(1) }), form: null } });

		const action = screen.getByRole('button', { name: 'Delete Entry 0' });
		expect(action.className).not.toContain('opacity-0');
	});

	it('heads no column the body leaves empty', () => {
		const { container } = render(ContentListPage, {
			props: { data: data({ items: items(1) }), form: null },
		});

		const headers = [...container.querySelectorAll('thead th')];
		const cells = [...container.querySelectorAll('tbody tr')][0].querySelectorAll('td');
		expect(cells).toHaveLength(headers.length);

		const actions = headers.findIndex((th) => th.textContent?.trim() === 'Actions');
		expect(actions).toBeGreaterThan(-1);
		expect(cells[actions].querySelector('button')).toBeTruthy();
	});
});

describe('content listing row links', () => {
	it('carry the page they were opened from so the entry can hand it back', () => {
		const { container } = render(ContentListPage, {
			props: { data: data({ offset: 200, items: items(100, 200) }), form: null },
		});
		const link = container.querySelector('tbody a[href^="/admin/content/posts/entry-200"]');
		expect(link?.getAttribute('href')).toBe('/admin/content/posts/entry-200-0000-0000-0000?limit=100&offset=200');
	});

	it('stay a clean path on the first page', () => {
		const { container } = render(ContentListPage, { props: { data: data(), form: null } });
		const link = container.querySelector('tbody a[href^="/admin/content/posts/entry-0"]');
		expect(link?.getAttribute('href')).toBe('/admin/content/posts/entry-0-0000-0000-0000');
	});
});
