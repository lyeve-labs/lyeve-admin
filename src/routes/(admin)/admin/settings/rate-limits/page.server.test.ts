import { describe, it, expect, vi, beforeEach } from 'vitest';

const api = vi.hoisted(() => ({
	listRules: vi.fn(),
	readOverview: vi.fn(),
	readStatus: vi.fn(),
	createRule: vi.fn(),
	updateRule: vi.fn(),
	deleteRule: vi.fn(),
	updateGlobal: vi.fn(),
	setProtection: vi.fn(),
	resetProtection: vi.fn(),
}));

vi.mock('$lib/api/rate-limit', async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	...api,
}));

const authz = vi.hoisted(() => ({
	roles: ['super_admin'] as string[],
	requireRole: vi.fn(),
}));

vi.mock('$lib/server/authz', () => ({
	authedClient: vi.fn(() => ({})),
	requireRole: authz.requireRole,
}));

import { load, actions } from './+page.server';

function formEvent(fields: Record<string, string>) {
	const body = new FormData();
	for (const [k, v] of Object.entries(fields)) body.set(k, v);
	return {
		request: new Request('http://admin/settings/rate-limits', { method: 'POST', body }),
		cookies: {},
		fetch: vi.fn(),
	} as never;
}

function loadEvent(roles: string[]) {
	return {
		url: new URL('http://admin/admin/settings/rate-limits'),
		fetch: vi.fn(),
		cookies: {},
		parent: async () => ({ entitlements: { features: ['rate-limit'] }, user: { roles } }),
	} as never;
}

const overview = {
	custom_licensed: false,
	global: null,
	protections: [],
	engine: [],
};

beforeEach(() => {
	vi.clearAllMocks();
	authz.roles = ['super_admin'];
	authz.requireRole.mockImplementation(async (_event: unknown, allowed: string[]) => {
		if (!allowed.some((r) => authz.roles.includes(r))) throw new Error('403');
		return { id: 'u1', roles: authz.roles };
	});
	api.listRules.mockResolvedValue({ data: [], total: 0 });
	api.readOverview.mockResolvedValue(overview);
	api.readStatus.mockResolvedValue({ data: [] });
});

describe('rate-limits load', () => {
	it('lists only custom rules and carries the capability flag from the engine', async () => {
		const result = (await load(loadEvent(['admin']))) as Record<string, unknown>;
		expect(api.listRules).toHaveBeenCalledWith(expect.anything(), 51, 0, 'custom');
		expect(result.overview).toEqual(overview);
		expect(result.superAdmin).toBe(false);
	});

	it('reports an unread overview as unknown, not as locked', async () => {
		api.readOverview.mockRejectedValue(new Error('down'));
		const result = (await load(loadEvent(['super_admin']))) as Record<string, unknown>;
		expect(result.overview).toBeNull();
		expect(result.superAdmin).toBe(true);
	});
});

describe('rate-limits actions', () => {
	it('refuses a rate or burst of zero, which the engine refuses too', async () => {
		const zeroRate = await actions.create(
			formEvent({ endpoint: 'GET /api/x', rate: '0', burst: '5', enabled: 'true' }),
		);
		expect(zeroRate).toMatchObject({ status: 400 });
		const zeroBurst = await actions.create(
			formEvent({ endpoint: 'GET /api/x', rate: '1', burst: '0', enabled: 'true' }),
		);
		expect(zeroBurst).toMatchObject({ status: 400 });
		expect(api.createRule).not.toHaveBeenCalled();
	});

	it('sends the role and key, and the tenant only for a super admin', async () => {
		await actions.create(
			formEvent({
				endpoint: 'GET /api/content/{schema}',
				rate: '2',
				burst: '4',
				enabled: 'true',
				role: 'editor',
				key_by: 'user',
				tenant_id: 'acme',
			}),
		);
		expect(api.createRule).toHaveBeenLastCalledWith(expect.anything(), {
			endpoint: 'GET /api/content/{schema}',
			rate: 2,
			burst: 4,
			enabled: true,
			role: 'editor',
			key_by: 'user',
			tenant_id: 'acme',
		});

		authz.roles = ['admin'];
		await actions.create(
			formEvent({ endpoint: 'GET /api/x', rate: '1', burst: '1', enabled: 'true', tenant_id: 'other' }),
		);
		const body = api.createRule.mock.calls.at(-1)?.[1] as Record<string, unknown>;
		expect(body).not.toHaveProperty('tenant_id');
	});

	it('keeps the global limit and the protections for a super admin', async () => {
		authz.roles = ['admin'];
		await expect(
			actions.global(formEvent({ rate: '1', burst: '1', enabled: 'true' })),
		).rejects.toThrow('403');
		await expect(
			actions.protection(formEvent({ name: 'mfa.verify', requests: '5', window_minutes: '5' })),
		).rejects.toThrow('403');
		expect(api.updateGlobal).not.toHaveBeenCalled();
		expect(api.setProtection).not.toHaveBeenCalled();
	});

	it('refuses a protection of zero requests and converts minutes to seconds', async () => {
		const zero = await actions.protection(
			formEvent({ name: 'mfa.verify', requests: '0', window_minutes: '5' }),
		);
		expect(zero).toMatchObject({ status: 400 });

		await actions.protection(formEvent({ name: 'mfa.verify', requests: '7', window_minutes: '10' }));
		expect(api.setProtection).toHaveBeenCalledWith(expect.anything(), {
			name: 'mfa.verify',
			requests: 7,
			window_seconds: 600,
		});
	});
});
