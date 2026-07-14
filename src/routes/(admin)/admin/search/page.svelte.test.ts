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

function data(overrides: Record<string, unknown> = {}) {
	return {
		entitlements,
		q: 'cats',
		results: [],
		searchFailed: false,
		synonyms: [],
		ranking: {
			id: '',
			schema_name: '*',
			title_weight: 1,
			body_weight: 0.4,
			tag_weight: 0.2,
			boost_rules: [],
			created_at: '',
			updated_at: '',
		},
		publicSchemas: [],
		schemas: ['blog'],
		analytics: null,
		canReindex: false,
		...overrides,
	};
}

describe('Search page results panel', () => {
	it('reports a backend failure instead of an empty result set', () => {
		const { getByText, queryByText } = render(SearchPage, {
			props: { data: data({ searchFailed: true }) as never, form: null },
		});
		expect(getByText('Search failed')).toBeTruthy();
		expect(queryByText('No results for "cats".')).toBeNull();
	});

	it('still reports an empty result set when the search succeeded', () => {
		const { getByText, queryByText } = render(SearchPage, {
			props: { data: data() as never, form: null },
		});
		expect(getByText('No results for "cats".')).toBeTruthy();
		expect(queryByText('Search failed')).toBeNull();
	});
});

describe('Search page settings', () => {
	it('offers each schema for public search and names what could not be read', () => {
		const { getByLabelText, getByText } = render(SearchPage, {
			props: { data: data({ publicSchemas: ['blog'] }) as never, form: null },
		});
		expect((getByLabelText('blog') as HTMLInputElement).checked).toBe(true);
		expect(getByText('Search analytics could not be read.')).toBeTruthy();
	});
});
