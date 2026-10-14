// @vitest-environment jsdom
import { render, cleanup } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Webhook } from '@lyeve-labs/client';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));

import DeliveriesDrawer from './DeliveriesDrawer.svelte';
import { DeliveryHistory } from './delivery-history.svelte';

afterEach(cleanup);

const delivery = (id: string, success: boolean) => ({
	id,
	webhook_id: 'w1',
	event_type: 'after_create',
	schema_name: 'post',
	status_code: success ? 200 : 500,
	success,
	error: success ? null : 'Connection refused',
	duration_ms: 12,
	attempted_at: '2026-01-01T00:00:00Z',
});

function named(): DeliveryHistory {
	const history = new DeliveryHistory();
	history.webhookId = 'w1';
	history.webhookName = 'Ship it';
	return history;
}

describe('the delivery history drawer', () => {
	it('stays shut until the action returns a history', () => {
		render(DeliveriesDrawer, { props: { form: null, history: named() } });
		expect(document.body.querySelector('[role="dialog"]')).toBeNull();
	});

	it('opens on the returned history, titled with the webhook it belongs to', () => {
		const history = named();
		render(DeliveriesDrawer, {
			props: { form: { deliveries: { id: 'w1', items: [delivery('d1', true), delivery('d2', false)] } }, history },
		});
		const dialog = document.body.querySelector('[role="dialog"]') as HTMLElement;
		expect(history.open).toBe(true);
		expect(dialog.textContent).toContain('Delivery history for Ship it');
		expect(dialog.querySelectorAll('tbody tr')).toHaveLength(2);
	});

	it('offers a retry on a failed delivery only, posting the webhook and the delivery', () => {
		render(DeliveriesDrawer, {
			props: { form: { deliveries: { id: 'w1', items: [delivery('d1', true), delivery('d2', false)] } }, history: named() },
		});
		const retries = [...document.body.querySelectorAll<HTMLFormElement>('form[action="?/retry-delivery"]')];
		expect(retries).toHaveLength(1);
		const body = new FormData(retries[0]);
		expect(body.get('id')).toBe('w1');
		expect(body.get('delivery_id')).toBe('d2');
	});

	it('says so when the webhook has made no attempt', () => {
		render(DeliveriesDrawer, { props: { form: { deliveries: { id: 'w1', items: [] } }, history: named() } });
		expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain('No deliveries recorded yet');
	});
});

describe('asking for a webhook history', () => {
	it('names the row and clears the last list before the result applies', async () => {
		const history = new DeliveryHistory();
		history.items = [delivery('old', true)] as never;
		const update = vi.fn(async () => {
			expect(history.items).toEqual([]);
		});
		const submit = history.load({ id: 'w2', name: 'Orders' } as Webhook);
		const after = (await submit({} as never)) as unknown as (input: { update: typeof update }) => Promise<void>;
		await after({ update });
		flushSync();
		expect(history.webhookId).toBe('w2');
		expect(history.webhookName).toBe('Orders');
		expect(update).toHaveBeenCalledWith({ reset: false });
	});
});
