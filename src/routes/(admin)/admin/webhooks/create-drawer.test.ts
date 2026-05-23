// @vitest-environment jsdom
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));

import WebhooksPage from './+page.svelte';

afterEach(cleanup);

const entitlements = { plan: 'example', state: 'active', features: ['webhook'], tenant_quota: 1 };

describe('webhooks create drawer posts a real event list', () => {
	it('names every checkbox so getAll("events") sees a list', async () => {
		const { container, getAllByText } = render(WebhooksPage, {
			props: {
				data: { webhooks: [], schemas: [{ name: 'post' }], entitlements, user: { roles: [] } },
				form: null
			} as never
		});

		await fireEvent.click(getAllByText("New webhook")[0]);

		const events = container.querySelectorAll('input[type="checkbox"][name="events"]');
		expect(events).toHaveLength(6);
		const schemas = container.querySelectorAll('input[type="checkbox"][name="schemas"]');
		expect(schemas).toHaveLength(1);
		expect(container.querySelector('input[type="hidden"][name="enabled"]')).toBeTruthy();
		expect(container.querySelector('input[type="password"][name="secret"]')).toBeTruthy();
		expect(container.querySelector('form[action="?/create"]')).toBeTruthy();
	});

	it('says what an empty delivery option means and when an option is refused', async () => {
		const { container, getAllByText } = render(WebhooksPage, {
			props: {
				data: { webhooks: [], schemas: [{ name: 'post' }], entitlements, user: { roles: [] } },
				form: null
			} as never
		});

		await fireEvent.click(getAllByText("New webhook")[0]);

		const options =
			[...container.querySelectorAll('fieldset')].find((f) => f.querySelector('legend')?.textContent === 'Delivery options')
				?.textContent ?? '';
		expect(options).toContain(
			'Leave a field empty to use the default. An option this instance does not enable is refused when you save.'
		);
	});
});
