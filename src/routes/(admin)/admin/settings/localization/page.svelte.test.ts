// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PageData } from './$types';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));

import LocalesPage from './+page.svelte';

afterEach(cleanup);

const LOCALES = { default_locale: 'en', enabled_locales: ['en', 'fr', 'de'], fallback_chain: ['fr', 'de'] };

function data(overrides: Record<string, unknown> = {}): PageData {
	return {
		locales: { ok: true, value: LOCALES },
		...overrides,
	} as unknown as PageData;
}

function hidden(name: string): string[] {
	return JSON.parse((document.querySelector(`input[name="${name}"]`) as HTMLInputElement).value);
}

describe('locales page', () => {
	it('says the plugin did not answer, and draws no form', () => {
		render(LocalesPage, { props: { data: data({ locales: { ok: false, gate: { state: 'unavailable' } } }), form: null } });
		expect(screen.getByText(/so Locales could not be read/)).toBeTruthy();
		expect(screen.queryByText('No locale enabled yet.')).toBeNull();
		expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
	});

	it('tells a role the plugin refuses that it cannot open the locales', () => {
		render(LocalesPage, { props: { data: data({ locales: { ok: false, gate: { state: 'forbidden' } } }), form: null } });
		expect(screen.getByText(/Your role cannot open Locales/)).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
	});

	it('lists the enabled locales with the default marked and the chain in order', () => {
		render(LocalesPage, { props: { data: data(), form: null } });
		expect(screen.getByText('Beta')).toBeTruthy();
		expect(screen.getByText('en (default)')).toBeTruthy();
		expect(screen.getByRole('list', { name: 'Fallback chain' }).textContent).toMatch(/1\.\s*fr.*2\.\s*de/s);
		expect(hidden('enabled_locales')).toEqual(['en', 'fr', 'de']);
		expect(hidden('fallback_chain')).toEqual(['fr', 'de']);
	});

	it('adds a locale, reorders the chain and takes a removed locale out of both', async () => {
		render(LocalesPage, { props: { data: data(), form: null } });

		const input = screen.getByRole('textbox', { name: /Add locale/ });
		await fireEvent.input(input, { target: { value: 'pt-BR' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Add locale' }));
		expect(hidden('enabled_locales')).toEqual(['en', 'fr', 'de', 'pt-BR']);

		await fireEvent.click(screen.getByRole('button', { name: 'Move de up' }));
		expect(hidden('fallback_chain')).toEqual(['de', 'fr']);

		await fireEvent.click(screen.getByRole('button', { name: 'Remove fr' }));
		expect(hidden('enabled_locales')).toEqual(['en', 'de', 'pt-BR']);
		expect(hidden('fallback_chain')).toEqual(['de']);
	});

	it('reports the refusal and the save', () => {
		render(LocalesPage, { props: { data: data(), form: { error: 'The fallback chain names de, which is not an enabled locale.', saved: false } as never } });
		expect(screen.getByText(/names de/)).toBeTruthy();
		cleanup();
		render(LocalesPage, { props: { data: data(), form: { saved: true, error: null, locales: LOCALES } as never } });
		expect(screen.getByText('Locales saved.')).toBeTruthy();
	});
});

describe('the fallback picker', () => {
	it('lets the locale to append be searched', async () => {
		render(LocalesPage, { props: { data: data({ locales: { ok: true, value: { ...LOCALES, fallback_chain: [] } } }), form: null } });
		await fireEvent.click(document.body.querySelector('#chain-pick') as HTMLElement);
		expect(screen.getByRole('combobox', { name: 'Search Append a locale' })).toBeTruthy();
	});
});
