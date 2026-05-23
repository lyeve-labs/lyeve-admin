import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiError } from '@lyeve-labs/client';

const api = vi.hoisted(() => ({
	readTenantGlobal: vi.fn(),
	setTenantGlobal: vi.fn(),
	clearTenantGlobal: vi.fn(),
	listAddressEntries: vi.fn(),
	createAddressEntry: vi.fn(),
	deleteAddressEntry: vi.fn(),
	readRefusalHistory: vi.fn(),
}));

vi.mock('$lib/api/rate-limit', async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	...api,
}));

vi.mock('$lib/server/authz', () => ({
	authedClient: vi.fn(() => ({})),
	requireRole: vi.fn(async () => ({ id: 'u1', roles: ['admin'] })),
}));

import { load, actions } from './+page.server';

type Loaded = Exclude<Awaited<ReturnType<typeof load>>, void>;

function loadEvent(query = '') {
	return {
		url: new URL(`http://admin/admin/settings/rate-limits/tenant${query}`),
		fetch: vi.fn(),
		cookies: {},
		parent: async () => ({ user: { roles: ['admin'] } }),
	} as never;
}

function formEvent(fields: Record<string, string>) {
	const body = new FormData();
	for (const [k, v] of Object.entries(fields)) body.set(k, v);
	return {
		request: new Request('http://admin/admin/settings/rate-limits/tenant', { method: 'POST', body }),
		cookies: {},
		fetch: vi.fn(),
	} as never;
}

const paymentRequired = () =>
	new ApiError(402, 'payment_required', { error: 'payment_required', plugin: 'example', feature: 'feature:example_feature' });

beforeEach(() => {
	vi.clearAllMocks();
	api.readTenantGlobal.mockResolvedValue({ licensed: false, tenant_global: null, install_global: null });
	api.listAddressEntries.mockResolvedValue({ licensed: false, limits: { entries: { limit: 500, current: 0 } }, rules: [] });
	api.readRefusalHistory.mockResolvedValue({ hours: 24, minutes: [], total_refused: 0 });
});

describe('tenant rate limits load', () => {
	it('reads each section on its own, with a day of history by default', async () => {
		const result = (await load(loadEvent())) as Loaded;
		expect(result.hours).toBe(24);
		expect(api.readRefusalHistory).toHaveBeenCalledWith(expect.anything(), 24);
		expect(result.limit.value?.licensed).toBe(false);
		expect(result.addresses.value?.limits?.entries).toEqual({ limit: 500, current: 0 });
	});

	it('takes the history window from the address and ignores one the plugin would refuse', async () => {
		await load(loadEvent('?hours=168'));
		expect(api.readRefusalHistory).toHaveBeenLastCalledWith(expect.anything(), 168);
		await load(loadEvent('?hours=9999'));
		expect(api.readRefusalHistory).toHaveBeenLastCalledWith(expect.anything(), 24);
	});

	// The history needs the license and the lists do not, so a refused history
	// is shown as locked beside lists that still read.
	it('locks the history alone when the plugin refuses it for the license', async () => {
		api.readRefusalHistory.mockRejectedValue(paymentRequired());
		const result = (await load(loadEvent())) as Loaded;
		expect(result.history.gate.state).toBe('locked');
		expect(result.addresses.gate.state).toBe('ok');
		expect(result.limit.gate.state).toBe('ok');
	});
});

describe('address list actions', () => {
	it('adds an entry to the list the form names', async () => {
		api.createAddressEntry.mockResolvedValue({});
		const out = await actions.addAddress(formEvent({ cidr: '203.0.113.0/24', list: 'deny', note: 'scraper' }));
		expect(api.createAddressEntry).toHaveBeenCalledWith(expect.anything(), {
			cidr: '203.0.113.0/24',
			list: 'deny',
			note: 'scraper',
		});
		expect(out).toEqual({ savedAddress: '203.0.113.0/24', list: 'deny' });
	});

	it('refuses something that is not an address before the round trip', async () => {
		const out = (await actions.addAddress(formEvent({ cidr: '203.0.113.300', list: 'allow' }))) as { status: number };
		expect(out.status).toBe(400);
		expect(api.createAddressEntry).not.toHaveBeenCalled();
	});

	// Three refusals of a new entry share 409, so the action reads the code
	// the plugin sends beside the sentence and never the sentence itself.
	const conflict = (code: string, message: string) => new ApiError(409, message, { error: message, code });

	it('marks the self-lockout conflict so the page can explain it', async () => {
		api.createAddressEntry.mockRejectedValue(conflict('rate_limit.self_lockout', 'reworded by the plugin'));
		const out = (await actions.addAddress(formEvent({ cidr: '10.0.0.0/8', list: 'deny' }))) as {
			status: number;
			data: { lockout: string };
		};
		expect(out.status).toBe(409);
		expect(out.data.lockout).toBe('10.0.0.0/8');
	});

	it('says the list is full when the tenant holds its ceiling', async () => {
		api.createAddressEntry.mockRejectedValue(conflict('rate_limit.list_full', 'a tenant holds at most 500 address entries'));
		const out = (await actions.addAddress(formEvent({ cidr: '10.0.0.1', list: 'allow' }))) as {
			status: number;
			data: { error: string; listFull?: boolean; lockout?: string };
		};
		expect(out.status).toBe(409);
		expect(out.data.listFull).toBe(true);
		expect(out.data.error).toContain('Remove one before adding another');
		expect(out.data.lockout).toBeUndefined();
	});

	it('names the list a duplicate range is already on', async () => {
		api.createAddressEntry.mockRejectedValue(conflict('rate_limit.duplicate_entry', 'that range is already on the list'));
		const out = (await actions.addAddress(formEvent({ cidr: '10.0.0.1', list: 'deny' }))) as {
			status: number;
			data: { error: string; duplicate?: string };
		};
		expect(out.data.error).toBe('10.0.0.1 is already on the deny list.');
		expect(out.data.duplicate).toBe('10.0.0.1');
	});

	it('relays a conflict without a code as it was sent', async () => {
		api.createAddressEntry.mockRejectedValue(new ApiError(409, 'this entry would refuse the address you are calling from'));
		const out = (await actions.addAddress(formEvent({ cidr: '10.0.0.1', list: 'allow' }))) as {
			status: number;
			data: { error: string; lockout?: string };
		};
		expect(out.data.error).toBe('this entry would refuse the address you are calling from');
		expect(out.data.lockout).toBeUndefined();
	});

	it('returns the license refusal on a paid write', async () => {
		api.setTenantGlobal.mockRejectedValue(paymentRequired());
		const out = (await actions.setLimit(formEvent({ rate: '5', burst: '10', enabled: 'true' }))) as {
			status: number;
			data: { refused: { kind: string } };
		};
		expect(out.status).toBe(402);
		expect(out.data.refused.kind).toBe('feature');
	});

	it('clears the tenant limit', async () => {
		api.clearTenantGlobal.mockResolvedValue(undefined);
		expect(await actions.clearLimit(formEvent({}))).toEqual({ clearedLimit: true });
	});
});
