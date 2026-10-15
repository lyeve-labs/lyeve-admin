// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import RefusalNotice from './RefusalNotice.svelte';
import FormErrors from './FormErrors.svelte';

afterEach(cleanup);

describe('RefusalNotice', () => {
	it('states a cap with the numbers the refusal carried and links the license page', () => {
		const { container, getByRole } = render(RefusalNotice, {
			props: { refusal: { kind: 'cap', cap: 'example.items', limit: 4, current: 4, upgradeUrl: '' } },
		});
		expect(container.textContent).toContain('4 of 4 items are in use');
		expect(getByRole('link', { name: 'View the license' }).getAttribute('href')).toBe('/admin/settings/license');
	});

	it('names the capability a feature refusal needs', () => {
		const { container } = render(RefusalNotice, {
			props: { refusal: { kind: 'feature', feature: 'example-feature', plugin: 'example', upgradeUrl: '' } },
		});
		expect(container.textContent).toContain('This needs example-feature');
	});

	it('names a license before removing one, and offers the link the engine sent for more', () => {
		const link = 'https://shop.example.com/pricing?utm_source=admin&utm_medium=product&utm_campaign=example.items';
		const { container, getByRole } = render(RefusalNotice, {
			props: { refusal: { kind: 'cap', cap: 'example.items', limit: 4, current: 4, upgradeUrl: link } },
		});
		expect(container.textContent).toContain('4 of 4 items are in use, which is the most this instance allows. A license that allows more lifts the limit. Removing one also makes room.');
		expect(getByRole('link', { name: 'View the license' }).getAttribute('href')).toBe('/admin/settings/license');
		// The link names neither a plan nor an add-on, so it keeps words of its own.
		const more = getByRole('link', { name: 'How to raise the limit' });
		expect(more.getAttribute('href')).toBe(link);
		expect(more.getAttribute('target')).toBe('_blank');
		expect(more.getAttribute('rel')).toBe('noopener noreferrer');
	});

	it('leads with the plan the engine names, as the primary action, and the license page after it', () => {
		const link = 'https://shop.example.com/pricing?plan=basic&utm_source=admin&utm_medium=product&utm_campaign=admin.seats';
		const { getAllByRole } = render(RefusalNotice, {
			props: { refusal: { kind: 'cap', cap: 'admin.seats', limit: 3, current: 3, upgradeUrl: link } },
		});
		const [first, second] = getAllByRole('link');
		expect(first.textContent?.trim()).toBe('View the plan');
		expect(first.getAttribute('href')).toBe(link);
		expect(first.classList.contains('bg-brand')).toBe(true);
		expect(second.textContent?.trim()).toBe('View the license');
		expect(second.classList.contains('bg-brand')).toBe(false);
	});

	it('names an add-on link by what it opens', () => {
		const link = 'https://shop.example.com/pricing?skus=example-pro&utm_source=admin&utm_medium=product&utm_campaign=example.items';
		const { getAllByRole } = render(RefusalNotice, {
			props: { refusal: { kind: 'cap', cap: 'example.items', limit: 4, current: 4, upgradeUrl: link } },
		});
		expect(getAllByRole('link').map((a) => a.textContent?.trim())).toEqual(['View the add-on', 'View the license']);
	});

	it('offers only the license page when the cap refusal names no link', () => {
		const { queryAllByRole } = render(RefusalNotice, {
			props: { refusal: { kind: 'cap', cap: 'admin.seats', limit: 3, current: 3, upgradeUrl: '' } },
		});
		expect(queryAllByRole('link').map((a) => a.textContent?.trim())).toEqual(['View the license']);
	});

	it('offers the link the engine sent beside the license page', () => {
		const { getByRole } = render(RefusalNotice, {
			props: { refusal: { kind: 'feature', feature: 'feature-b', plugin: 'widgets', upgradeUrl: 'https://example.com/license' } },
		});
		expect(getByRole('link', { name: 'How to enable it' }).getAttribute('href')).toBe('https://example.com/license');
	});
});

describe('FormErrors with a refusal', () => {
	it('renders the refusal in place of the plain message', () => {
		const { container } = render(FormErrors, {
			props: {
				message: 'raw',
				refused: { kind: 'cap', cap: 'gadgets.probes', limit: 7, current: 7, upgradeUrl: '' },
			},
		});
		expect(container.textContent).toContain('7 of 7 probes are in use');
		expect(container.textContent).not.toContain('raw');
	});
});
