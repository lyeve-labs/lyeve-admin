// @vitest-environment jsdom
import { render, cleanup, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import SearchPage from './+page.svelte';
import type { Entitlements } from '$lib/entitlements';
import { outlineSkips } from '$lib/test-outline';

afterEach(cleanup);

const entitlements: Entitlements = {
	plan: 'example',
	state: 'active',
	features: ['search'],
	tenant_quota: 1,
};

const ok = (value: unknown) => ({ ok: true, value });

function data(overrides: Record<string, unknown> = {}) {
	return {
		entitlements,
		q: 'cats',
		limit: 20,
		offset: 0,
		results: ok({ results: [], total: 0 }),
		synonyms: ok({ groups: [], total: 0 }),
		ranking: ok({
			id: '',
			schema_name: '*',
			title_weight: 1,
			body_weight: 0.4,
			tag_weight: 0.2,
			boost_rules: [],
			created_at: '',
			updated_at: '',
		}),
		publicSchemas: ok([]),
		schemas: ok(['blog']),
		analytics: { ok: false, gate: { state: 'error', message: 'Search analytics could not be read.' } },
		canReindex: false,
		...overrides,
	};
}

describe('Search page results panel', () => {
	it('reports a backend failure instead of an empty result set', () => {
		const { getByText, queryByText } = render(SearchPage, {
			props: { data: data({ results: { ok: false, gate: { state: 'unavailable' } } }) as never, form: null },
		});
		expect(getByText(/Search could not be read/)).toBeTruthy();
		expect(queryByText('No results for "cats".')).toBeNull();
	});

	it('names the schemas in lower case inside the role refusal', () => {
		const { container } = render(SearchPage, {
			props: { data: data({ schemas: { ok: false, gate: { state: 'forbidden' } } }) as never, form: null },
		});
		expect(container.textContent).toContain('Your role cannot open the schemas.');
	});

	it('still reports an empty result set when the search succeeded', () => {
		const { getByText, queryByText } = render(SearchPage, {
			props: { data: data() as never, form: null },
		});
		expect(getByText('No results for "cats".')).toBeTruthy();
		expect(queryByText(/Search could not be read/)).toBeNull();
	});
});

/** Each heading level that follows one more than a level shallower, in document order. */
function skippedLevels(): string[] {
	const levels = [...document.querySelectorAll('h1, h2, h3, h4, h5, h6')].map((h) => ({ level: Number(h.tagName[1]), text: h.textContent?.trim() ?? '' }));
	return levels.filter((h, i) => i > 0 && h.level > levels[i - 1].level + 1).map((h) => `h${h.level} ${h.text}`);
}

describe('Search page settings', () => {
	it('puts its settings cards one level under the page title', () => {
		const results = ok({ results: [{ entry_id: 'e0', title: 'Entry 0', schema: 'blog', status: 'published', rank: 1 }], total: 1 });
		render(SearchPage, { props: { data: data({ results, publicSchemas: ok(['blog']) }) as never, form: null } });
		expect(document.querySelector('h1')).not.toBeNull();
		expect(skippedLevels()).toEqual([]);
		// The settings sit beside the results, not under them, so they are peers of its heading.
		for (const name of ['Public search', 'Ranking weights', 'Synonyms']) {
			expect(screen.getByRole('heading', { level: 2, name })).toBeTruthy();
		}
	});

	it('offers each schema for public search in a searchable picker and names what could not be read', () => {
		const { container, getByText } = render(SearchPage, {
			props: { data: data({ publicSchemas: ok(['blog']) }) as never, form: null },
		});
		expect(container.querySelector('input[type="hidden"][name="schemas"]')?.getAttribute('value')).toBe('blog');
		expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
		expect(getByText('Search analytics could not be read.')).toBeTruthy();
	});

	it('offers no weights and no Save when the ranking read failed', () => {
		const { getByText, queryByLabelText } = render(SearchPage, {
			props: { data: data({ ranking: { ok: false, gate: { state: 'unavailable' } } }) as never, form: null },
		});
		expect(getByText(/Ranking weights could not be read/)).toBeTruthy();
		expect(queryByLabelText('Title')).toBeNull();
	});

	it('says the synonyms and the schemas could not be read instead of calling them empty', () => {
		const { getByText, queryByText, queryByRole } = render(SearchPage, {
			props: {
				data: data({
					synonyms: { ok: false, gate: { state: 'error', message: 'The synonym groups could not be read.' } },
					schemas: { ok: false, gate: { state: 'error', message: 'The schemas could not be read.' } },
				}) as never,
				form: null,
			},
		});
		expect(getByText('The synonym groups could not be read.')).toBeTruthy();
		expect(getByText('The schemas could not be read.')).toBeTruthy();
		expect(queryByText(/No synonym groups/)).toBeNull();
		expect(queryByText('No schemas yet')).toBeNull();
		expect(queryByRole('button', { name: /New synonym/ })).toBeNull();
	});

	it('offers the first synonym group when there are none', () => {
		const { getByText, getAllByRole } = render(SearchPage, { props: { data: data() as never, form: null } });
		expect(getByText('No synonym groups yet')).toBeTruthy();
		expect(getAllByRole('button', { name: /New synonym/ }).length).toBeGreaterThan(0);
	});
});

describe('Search page counts', () => {
	const hit = (n: number) => ({ entry_id: `e${n}`, title: `Entry ${n}`, schema: 'blog', status: 'published', rank: 1 });

	// The plugin answers one page. The count is its total, not the rows held.
	it('states the total the plugin counted and pages to the rest', () => {
		const results = ok({ results: Array.from({ length: 20 }, (_, i) => hit(i)), total: 73 });
		const { getByRole, container } = render(SearchPage, { props: { data: data({ results }) as never, form: null } });
		expect(getByRole('heading', { level: 2, name: /73 results for "cats"/ })).toBeTruthy();
		expect(container.querySelector('a[href="/admin/search?q=cats&limit=20&offset=20"]')).toBeTruthy();
	});

	it('says when more synonym groups exist than were listed', () => {
		const groups = [{ id: 's1', base_term: 'tv', synonyms: ['telly'] }];
		const { getByText } = render(SearchPage, {
			props: { data: data({ synonyms: ok({ groups, total: 612 }) }) as never, form: null },
		});
		expect(getByText(/The first 1 of 612 groups are listed/)).toBeTruthy();
	});

	it('shows a failed delete beside the groups and not in the next New synonym drawer', () => {
		const groups = [{ id: 's1', base_term: 'tv', synonyms: ['telly'] }];
		const { getByText, getAllByText } = render(SearchPage, {
			props: {
				data: data({ synonyms: ok({ groups, total: 1 }) }) as never,
				form: { synonymDeleteError: 'The synonym could not be deleted.' } as never,
			},
		});
		expect(getByText('The synonym could not be deleted.')).toBeTruthy();
		expect(getAllByText('The synonym could not be deleted.')).toHaveLength(1);
	});
});

// A heading list that jumps from h1 to h3 reads to a screen reader as a
// missing section.
describe('heading outline', () => {
	it('steps its headings down one level at a time', () => {
		const { container } = render(SearchPage, { props: { data: data() as never, form: null } });
		expect(outlineSkips(container)).toEqual([]);
	});

	it('steps its headings down one level at a time while the feature is not enabled', () => {
		const { container } = render(SearchPage, {
			props: { data: data({ results: { ok: false, gate: { state: 'locked', upgradeUrl: '' } } }) as never, form: null },
		});
		expect(container.querySelector('[data-testid="not-enabled"]')).toBeTruthy();
		expect(outlineSkips(container)).toEqual([]);
	});
});
