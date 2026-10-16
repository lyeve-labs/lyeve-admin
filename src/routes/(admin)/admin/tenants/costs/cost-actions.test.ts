import { describe, expect, it, vi } from 'vitest';
import type { Cookies } from '@sveltejs/kit';

import { actions } from './+page.server';

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function mockCookies(): Cookies {
	return {
		get: vi.fn(() => 'tok'),
		set: vi.fn(),
		delete: vi.fn(),
		getAll: vi.fn(() => []),
		serialize: vi.fn(() => ''),
	} as unknown as Cookies;
}

/** An action event whose fetch answers the session read as `roles`, then `answer` for the write. */
function writeEvent(fields: Record<string, string>, answer: () => Response, roles = ['admin']) {
	const form = new FormData();
	for (const [key, value] of Object.entries(fields)) form.append(key, value);
	const written = vi.fn(answer);
	const fetch = vi.fn(async (url: string, init?: RequestInit) =>
		String(url).includes('/auth/me') ? json({ id: 'u1', email: 'a@example.com', roles }) : written(),
	) as unknown as typeof globalThis.fetch;
	return {
		written,
		event: {
			request: { formData: async () => form },
			fetch,
			cookies: mockCookies(),
			url: new URL('http://localhost/admin/tenants/costs'),
		} as never,
	};
}

const BUDGET = {
	name: 'Storage cap',
	amount: '250',
	period: 'monthly',
	period_start: '2026-10-01',
	period_end: '2026-10-31',
};
const PRICE = { resource_type: 'storage', unit_price: '0.09', per_units: '1073741824' };

/** Each write with the fields that pass the form's own checks. */
const WRITES = {
	createBudget: { fields: BUDGET, form: 'budget-new', saved: { form: 'budget', saved: true } },
	deleteBudget: { fields: { id: 'b1' }, form: 'budget', saved: { form: 'budget', saved: true } },
	putPrice: { fields: PRICE, form: 'price', saved: { form: 'price', saved: true } },
	resetPrice: { fields: { resource_type: 'storage' }, form: 'price', saved: { form: 'price', saved: true } },
	aggregate: { fields: {}, form: 'aggregate', saved: { form: 'aggregate', saved: true } },
} as const;

const NAMES = Object.keys(WRITES) as (keyof typeof WRITES)[];

describe('tenant costs writes', () => {
	it.each(NAMES)('%s reports a write the plugin accepts', async (name) => {
		const { event, written } = writeEvent(WRITES[name].fields, () => json({ id: 'b1', entries_written: 0 }));
		expect(await actions[name](event)).toMatchObject(WRITES[name].saved);
		expect(written).toHaveBeenCalledTimes(1);
	});

	it.each(NAMES)('%s relays a refusal under its own form', async (name) => {
		const { event } = writeEvent(WRITES[name].fields, () => json({ error: 'budget not found' }, 404));
		expect(await actions[name](event)).toEqual({
			status: 400,
			data: { form: WRITES[name].form, error: 'budget not found', locked: false },
		});
	});

	it.each(NAMES)('%s says the ledger is not enabled on a license refusal', async (name) => {
		const { event } = writeEvent(WRITES[name].fields, () => json({ error: 'payment_required', feature: 'feature:example_feature' }, 402));
		expect(await actions[name](event)).toMatchObject({ status: 402, data: { form: WRITES[name].form, locked: true } });
	});

	it.each(NAMES)('%s keeps driver text out of an outage', async (name) => {
		const { event } = writeEvent(WRITES[name].fields, () => json({ error: 'pq: connection refused' }, 503));
		const result = (await actions[name](event)) as { data: { error: string } };
		expect(result.data.error).not.toContain('pq:');
	});

	it.each(NAMES)('%s is refused to an editor before anything is written', async (name) => {
		const { event, written } = writeEvent(WRITES[name].fields, () => json({}), ['editor']);
		await expect(actions[name](event)).rejects.toMatchObject({ status: 403 });
		expect(written).not.toHaveBeenCalled();
	});
});
