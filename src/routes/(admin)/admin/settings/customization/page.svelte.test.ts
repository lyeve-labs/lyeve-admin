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
		await fireEvent.click(screen.getByRole('button', { name: /new page/i }));
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
