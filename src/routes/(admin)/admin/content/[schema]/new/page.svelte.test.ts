// @vitest-environment jsdom
import { render, cleanup } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy: () => {} }) }));

import NewEntryPage from './+page.svelte';

afterEach(cleanup);

const schemaDef = {
	name: 'posts',
	display_name: 'Posts',
	with_localization: true,
	fields: [{ name: 'title', field_type: 'text', required: false, unique: false, indexed: false }],
};

function data(locales: unknown) {
	return { schemaDef, relations: {}, locales, mediaChoices: [] } as never;
}

describe('new entry locale', () => {
	it('names the locale picker', () => {
		const { getByLabelText } = render(NewEntryPage, {
			props: {
				data: data({ ok: true, value: [{ code: 'en', name: 'en', is_default: true }, { code: 'fr', name: 'fr', is_default: false }] }),
				form: null,
			},
		});
		expect(getByLabelText('Locale')).toBeTruthy();
	});

	it('says the locales could not be read instead of hiding the picker in silence', () => {
		const { getByText, queryByLabelText } = render(NewEntryPage, {
			props: { data: data({ ok: false, gate: { state: 'unavailable' } }), form: null },
		});
		expect(getByText(/The locales could not be read/)).toBeTruthy();
		expect(queryByLabelText('Locale')).toBeNull();
	});

	it('offers no locale on an instance without the localization plugin', () => {
		const { queryByLabelText, queryByText } = render(NewEntryPage, { props: { data: data(null), form: null } });
		expect(queryByLabelText('Locale')).toBeNull();
		expect(queryByText(/could not be read/)).toBeNull();
	});
});
