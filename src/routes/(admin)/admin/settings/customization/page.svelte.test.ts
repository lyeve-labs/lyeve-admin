// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));

import CustomizationPage from './+page.svelte';

afterEach(cleanup);

const settings = {
	brand: { name: 'Acme', logo_url: '', favicon_url: '', accent: '', welcome: '' },
	menu: { hidden: [], pinned: [], links: [] },
	home_page: '',
};

function props(over: Record<string, unknown> = {}, form: unknown = null) {
	return {
		data: {
			gate: { state: 'ok' },
			entitled: true,
			settings,
			pages: [],
			navChoices: [{ id: 'media', label: 'Media', section: 'Content' }],
			mediaChoices: [],
			dashboard: { entitled: true, custom: false, widgets: [], updated_at: null },
			user: { roles: ['admin'] },
			...over,
		},
		form,
	} as never;
}

describe('customization when it could not be read', () => {
	it('says the engine did not answer rather than that customization is not enabled', () => {
		const { container } = render(CustomizationPage, {
			props: props({ gate: { state: 'unavailable' }, entitled: false }),
		});
		expect(container.textContent).toContain('so Customization could not be read');
		expect(screen.queryByTestId('not-enabled')).toBeNull();
	});
});

/*
 * The link and page drawers each read their own failure key. A drawer opened
 * over an older failure starts clean.
 */
describe('the customization drawers and older failures', () => {
	const linkText = () => document.body.querySelector('form#link-form')?.textContent ?? '';
	const pageText = () => document.body.querySelector('form#page-form')?.textContent ?? '';

	it('opens the page drawer clean after a failed link save', async () => {
		render(CustomizationPage, { props: props({}, { linkError: 'The link could not be saved.' }) });
		await fireEvent.click(screen.getAllByRole('button', { name: /new page/i })[0]);
		expect(pageText()).not.toContain('could not be saved');
	});

	it('shows a failed link save first in the open link drawer, and not when reopened', async () => {
		const { rerender } = render(CustomizationPage, { props: props() });
		await fireEvent.click(screen.getByRole('button', { name: /new link/i }));
		await rerender(props({}, { linkError: 'Check the highlighted fields.', fields: { label: 'Required' } }));
		const form = document.body.querySelector('form#link-form') as HTMLFormElement;
		expect(form.firstElementChild?.textContent).toContain('Check the highlighted fields.');
		await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
		await fireEvent.click(screen.getByRole('button', { name: /new link/i }));
		expect(linkText()).not.toContain('Check the highlighted fields.');
	});
});

describe('the customization controls', () => {
	it('picks hidden and pinned entries from searchable lists and posts each pick', () => {
		const { container } = render(CustomizationPage, {
			props: props({
				settings: { ...settings, menu: { hidden: ['media'], pinned: ['media', 'users'], links: [] } },
				navChoices: [
					{ id: 'media', label: 'Media', section: 'Content' },
					{ id: 'users', label: 'Users', section: 'Access' },
				],
			}),
		});
		expect(container.querySelectorAll('input[type="checkbox"][name="hidden"]')).toHaveLength(0);
		expect(container.querySelector('#menu-hidden')).toBeTruthy();
		const posted = (name: string) =>
			[...container.querySelectorAll(`input[type="hidden"][name="${name}"]`)].map((i) => (i as HTMLInputElement).value);
		expect(posted('hidden')).toEqual(['media']);
		// A hidden entry cannot also be pinned.
		expect(posted('pinned')).toEqual(['users']);
	});

	it('shows a failed page delete in the Pages card, not beside the dashboard form', () => {
		render(CustomizationPage, {
			props: props({ pages: [{ slug: 'welcome', title: 'Welcome', roles: [], blocks: [] }] }, { pageDeleteError: 'The page could not be deleted.' }),
		});
		const alert = screen.getByText('The page could not be deleted.');
		const pagesHeading = screen.getByRole('heading', { name: 'Pages' });
		expect(pagesHeading.compareDocumentPosition(alert) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
		expect(screen.getByTestId('dashboard-state').parentElement?.textContent).not.toContain('could not be deleted');
	});

	it('offers the first page from the empty pages list', () => {
		render(CustomizationPage, { props: props() });
		expect(screen.getAllByRole('button', { name: /new page/i })).toHaveLength(2);
	});
});

/*
 * Every save on the page reruns the load. Reseeding every form from it wiped
 * what the other forms held unsaved, so a new link took the brand name being
 * typed with it.
 */
describe('unsaved customization edits', () => {
	const withLink = (links: { label: string; url: string }[]) => ({ ...settings, menu: { ...settings.menu, links } });

	it('survive a save of another form', async () => {
		const { rerender } = render(CustomizationPage, { props: props() });
		const brandName = document.querySelector('#brand-name') as HTMLInputElement;
		await fireEvent.input(brandName, { target: { value: 'Acme Labs' } });
		await rerender(props({ settings: withLink([{ label: 'Wiki', url: 'https://wiki.example.com' }]) }, { linkSaved: true }));
		expect((document.querySelector('#brand-name') as HTMLInputElement).value).toBe('Acme Labs');
	});

	it('follow the brand once a brand save stores a new one', async () => {
		const { rerender } = render(CustomizationPage, { props: props() });
		await fireEvent.input(document.querySelector('#brand-name') as HTMLInputElement, { target: { value: 'Draft' } });
		await rerender(props({ settings: { ...settings, brand: { ...settings.brand, name: 'Stored' } } }, { brandSaved: true }));
		expect((document.querySelector('#brand-name') as HTMLInputElement).value).toBe('Stored');
	});
});
