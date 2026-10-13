// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));

import IncomingPage from './+page.svelte';

afterEach(cleanup);

const entitlements = { plan: 'example', state: 'active', features: ['webhook'], tenant_quota: 1 };

const stripe = {
	id: 'i1',
	name: 'Stripe',
	schema_name: 'orders',
	enabled: true,
	field_map: { id: 'external_id' },
	allowed_ips: [],
};

function setup(over: Record<string, unknown> = {}, form: unknown = null) {
	return render(IncomingPage, {
		props: {
			data: {
				incomingWebhooks: { ok: true, value: [stripe] },
				schemas: { ok: true, value: [{ name: 'orders' }] },
				entitlements,
				user: { roles: ['super_admin'] },
				...over,
			},
			form,
		} as never,
	});
}

describe('the incoming webhook list when it could not be read', () => {
	it('says the engine did not answer and offers no first endpoint', () => {
		const { container, queryByRole } = setup({ incomingWebhooks: { ok: false, gate: { state: 'unavailable' } } });
		expect(container.textContent).toContain('so Incoming webhooks could not be read. Nothing was changed.');
		expect(container.textContent).not.toContain('No incoming webhooks');
		expect(queryByRole('button', { name: /new incoming webhook/i })).toBeNull();
	});

	it('keeps the first-run state for a list that answered empty', () => {
		const { container, getAllByRole } = setup({ incomingWebhooks: { ok: true, value: [] } });
		expect(container.textContent).toContain('No incoming webhooks');
		expect(getAllByRole('button', { name: /new incoming webhook/i })).toHaveLength(2);
	});
});
