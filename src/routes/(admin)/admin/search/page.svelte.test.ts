// @vitest-environment jsdom
import { render, cleanup } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import SearchPage from './+page.svelte';
import type { Entitlements } from '$lib/entitlements';

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
		results: ok([]),
		synonyms: ok([]),
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

	it('still reports an empty result set when the search succeeded', () => {
		const { getByText, queryByText } = render(SearchPage, {
			props: { data: data() as never, form: null },
		});
		expect(getByText('No results for "cats".')).toBeTruthy();
		expect(queryByText(/Search could not be read/)).toBeNull();
	});
});

describe('Search page settings', () => {
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
