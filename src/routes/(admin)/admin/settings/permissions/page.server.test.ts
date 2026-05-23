import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Cookies } from '@sveltejs/kit';

vi.mock('@lyeve-labs/client', () => ({
	createClient: vi.fn(() => ({})),
	ApiError: class ApiError extends Error {
		status: number;
		constructor(status: number, message: string) {
			super(message);
			this.status = status;
		}
	},
}));

vi.mock('@lyeve-labs/client-rest', () => ({
	listPermissions: vi.fn(),
	getSchemas: vi.fn(),
	upsertPermission: vi.fn(),
	deletePermission: vi.fn(),
}));

const flows = vi.hoisted(() => ({ listAllFlows: vi.fn(async () => [] as { id: string; slug: string; name: string }[]) }));
vi.mock('$lib/api/flows', () => ({ listAllFlows: flows.listAllFlows }));

const limits = vi.hoisted(() => ({ getRoleLimits: vi.fn(async (): Promise<{ roles: { limit: number; current: number } }> => ({ roles: { limit: 0, current: 0 } })) }));
vi.mock('$lib/api/permissions', () => ({ getRoleLimits: limits.getRoleLimits }));

vi.mock('$lib/server/authz', () => ({
	authedClient: vi.fn(() => ({})),
	requireRole: vi.fn(async () => ({ id: 'u1', roles: ['super_admin'] })),
}));

import { load, actions } from './+page.server';
import { listPermissions, getSchemas, upsertPermission } from '@lyeve-labs/client-rest';

const mockedListPermissions = vi.mocked(listPermissions);
const mockedGetSchemas = vi.mocked(getSchemas);
const mockedUpsertPermission = vi.mocked(upsertPermission);

function mockCookies(): Cookies {
	return { get: vi.fn(() => 'session-token') } as unknown as Cookies;
}

function loadEvent() {
	return {
		fetch: vi.fn(),
		cookies: mockCookies(),
		parent: async () => ({ user: { roles: ['super_admin'] } }),
	} as never;
}

interface LoadResult {
	permissions: unknown[];
	schemas: unknown[];
	loadError: string | null;
}

const permission = {
	id: 'a1b2c3d4-0000-0000-0000-000000000000',
	role: 'editor',
	schema_name: 'article',
	actions: ['read'],
	field_mask: [],
	created_at: '2026-01-01T00:00:00Z',
};

beforeEach(() => {
	vi.clearAllMocks();
});

describe('permissions +page.server.ts load', () => {
	it('returns the rules and schemas when both reads succeed', async () => {
		mockedListPermissions.mockResolvedValue([permission] as never);
		mockedGetSchemas.mockResolvedValue([{ name: 'article' }] as never);

		const result = (await load(loadEvent())) as unknown as LoadResult;

		expect(result.permissions).toEqual([permission]);
		expect(result.schemas).toEqual([{ name: 'article' }]);
		expect(result.loadError).toBeNull();
	});

	it('reports a failed read rather than an empty matrix', async () => {
		// Swallowing the failure would render a page that says this instance
		// restricts nothing, on a screen whose next action grants access.
		mockedListPermissions.mockRejectedValue(new Error('503 service unavailable'));
		mockedGetSchemas.mockResolvedValue([{ name: 'article' }] as never);

		const result = (await load(loadEvent())) as unknown as LoadResult;

		expect(result.loadError).toBeTruthy();
		expect(result.permissions).toEqual([]);
	});

	it('reports a failed schema read too', async () => {
		mockedListPermissions.mockResolvedValue([permission] as never);
		mockedGetSchemas.mockRejectedValue(new Error('session expired'));

		const result = (await load(loadEvent())) as unknown as LoadResult;

		expect(result.loadError).toBeTruthy();
		expect(result.schemas).toEqual([]);
	});

	it('keeps the engine message out of the response', async () => {
		mockedListPermissions.mockRejectedValue(new Error('pq: SSL is not enabled on the server'));
		mockedGetSchemas.mockResolvedValue([] as never);

		const result = (await load(loadEvent())) as unknown as LoadResult;

		expect(result.loadError).not.toContain('pq:');
		expect(result.loadError).not.toContain('SSL');
	});

	it('refuses a session without super_admin', async () => {
		const event = {
			fetch: vi.fn(),
			cookies: mockCookies(),
			parent: async () => ({ user: { roles: ['editor'] } }),
		} as never;

		await expect(load(event)).rejects.toMatchObject({ status: 403 });
		expect(mockedListPermissions).not.toHaveBeenCalled();
	});
});

function upsertEvent(fields: Record<string, string | string[]>) {
	const body = new FormData();
	for (const [k, v] of Object.entries(fields)) {
		for (const one of Array.isArray(v) ? v : [v]) body.append(k, one);
	}
	return {
		request: new Request('http://localhost/admin/settings/permissions?/upsert', {
			method: 'POST',
			body,
		}),
		fetch: vi.fn(),
		cookies: mockCookies(),
	} as never;
}

describe('permissions +page.server.ts role ceiling', () => {
	it('takes the ceiling and the count from the plugin', async () => {
		mockedListPermissions.mockResolvedValue([permission] as never);
		mockedGetSchemas.mockResolvedValue([] as never);
		limits.getRoleLimits.mockResolvedValueOnce({ roles: { limit: 7, current: 6 } });
		const result = (await load(loadEvent())) as LoadResult & { roleCap: number; roleCount: number | null };
		expect(result.roleCap).toBe(7);
		expect(result.roleCount).toBe(6);
	});

	it('states no ceiling when the plugin has no limits read, and still lists the rules', async () => {
		mockedListPermissions.mockResolvedValue([permission] as never);
		mockedGetSchemas.mockResolvedValue([] as never);
		limits.getRoleLimits.mockRejectedValueOnce(new Error('not found'));
		const result = (await load(loadEvent())) as LoadResult & { roleCap: number; roleCount: number | null };
		expect(result.roleCap).toBe(0);
		expect(result.roleCount).toBeNull();
		expect(result.loadError).toBeNull();
		expect(result.permissions).toHaveLength(1);
	});

	it('keeps the ceiling when the rules cannot be read', async () => {
		mockedListPermissions.mockRejectedValue(new Error('down'));
		limits.getRoleLimits.mockResolvedValueOnce({ roles: { limit: 7, current: 7 } });
		const result = (await load(loadEvent())) as LoadResult & { roleCap: number };
		expect(result.roleCap).toBe(7);
		expect(result.loadError).toBeTruthy();
	});
});

describe('permissions +page.server.ts flows as resources', () => {
	it('lists the flows beside the schemas', async () => {
		mockedListPermissions.mockResolvedValue([permission] as never);
		mockedGetSchemas.mockResolvedValue([{ name: 'article' }] as never);
		flows.listAllFlows.mockResolvedValueOnce([{ id: 'f1', slug: 'send-receipt', name: 'Send receipt' }]);
		const result = (await load(loadEvent())) as LoadResult & { flows: { slug: string }[] };
		expect(result.flows.map((f) => f.slug)).toEqual(['send-receipt']);
		expect(result.loadError).toBeNull();
	});

	it('reads an instance without the flow plugin as no flows, not a failed read', async () => {
		mockedListPermissions.mockResolvedValue([permission] as never);
		mockedGetSchemas.mockResolvedValue([] as never);
		flows.listAllFlows.mockRejectedValueOnce(new Error('404'));
		const result = (await load(loadEvent())) as LoadResult & { flows: unknown[] };
		expect(result.flows).toEqual([]);
		expect(result.loadError).toBeNull();
	});

	it('refuses activate on a schema before calling the engine', async () => {
		mockedUpsertPermission.mockClear();
		const result = (await actions.upsert(upsertEvent({ role: 'editor', schema_name: 'article', actions: ['read', 'activate'] }))) as { status: number; data: { error: string } };
		expect(result.status).toBe(422);
		expect(result.data.error).toContain('flows only');
		expect(mockedUpsertPermission).not.toHaveBeenCalled();
	});

	it('writes activate on a flow resource', async () => {
		mockedUpsertPermission.mockResolvedValue(permission as never);
		const result = await actions.upsert(upsertEvent({ role: 'publisher', schema_name: 'flow:send-receipt', actions: ['read', 'activate'] }));
		expect(result).toEqual({ success: true });
		expect(mockedUpsertPermission).toHaveBeenCalledWith(
			{ role: 'publisher', schema_name: 'flow:send-receipt', actions: ['read', 'activate'], field_mask: [] },
			expect.anything(),
		);
	});
});

describe('permissions +page.server.ts actions.upsert', () => {
	it('writes a wildcard rule with no actions for a new role', async () => {
		mockedUpsertPermission.mockResolvedValue(permission as never);

		const result = await actions.upsert(upsertEvent({ role: 'reviewer', schema_name: '*' }));

		expect(result).toEqual({ success: true });
		expect(mockedUpsertPermission).toHaveBeenCalledWith(
			{ role: 'reviewer', schema_name: '*', actions: [], field_mask: [] },
			expect.anything(),
		);
	});

	it('trims a hand typed role name', async () => {
		// Untrimmed, "editor " is a second role the matrix lists beside the
		// real one and no session ever matches.
		mockedUpsertPermission.mockResolvedValue(permission as never);

		await actions.upsert(upsertEvent({ role: '  reviewer ', schema_name: '*' }));

		expect(mockedUpsertPermission).toHaveBeenCalledWith(
			expect.objectContaining({ role: 'reviewer' }),
			expect.anything(),
		);
	});

	it('rejects a blank role without calling the engine', async () => {
		const result = await actions.upsert(upsertEvent({ role: '   ', schema_name: '*' }));

		expect(result).toMatchObject({ status: 422 });
		expect(mockedUpsertPermission).not.toHaveBeenCalled();
	});
});
