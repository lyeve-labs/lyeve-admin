import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiError } from '@lyeve-labs/client';

const api = vi.hoisted(() => ({
	readStats: vi.fn(),
	listProviders: vi.fn(),
	listEntries: vi.fn(),
	listRules: vi.fn(),
	createRule: vi.fn(),
	updateRule: vi.fn(),
	deleteRule: vi.fn(),
	purgeRule: vi.fn(),
	purgeResponses: vi.fn(),
	flushAll: vi.fn(),
	flushTag: vi.fn(),
	resetCircuit: vi.fn(),
}));

vi.mock('$lib/api/cache', async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	...api,
}));

const authz = vi.hoisted(() => ({
	roles: ['admin'] as string[],
	requireRole: vi.fn(),
}));

vi.mock('$lib/server/authz', () => ({
	authedClient: vi.fn(() => ({})),
	requireRole: authz.requireRole,
}));

import { load, actions } from './+page.server';

type Loaded = Exclude<Awaited<ReturnType<typeof load>>, void>;

function loadEvent(roles: string[]) {
	return {
		url: new URL('http://admin/admin/observability/cache'),
		fetch: vi.fn(),
		cookies: {},
		parent: async () => ({ user: { roles } }),
	} as never;
}

function formEvent(fields: Record<string, string>) {
	const body = new FormData();
	for (const [k, v] of Object.entries(fields)) body.set(k, v);
	return {
		request: new Request('http://admin/admin/observability/cache', { method: 'POST', body }),
		cookies: {},
		fetch: vi.fn(),
	} as never;
}

const rule = {
	id: '7d3c6f0e-1d1b-4a8e-9f55-0a4f2b1c9e11',
	pattern: '/api/v1/content/posts/**',
	ttl_seconds: 300,
	tags: ['posts'],
	enabled: true,
	created_at: '2026-10-01T00:00:00Z',
	updated_at: '2026-10-01T00:00:00Z',
};

beforeEach(() => {
	vi.clearAllMocks();
	authz.roles = ['admin'];
	authz.requireRole.mockImplementation(async (_event: unknown, allowed: string[]) => {
		if (!allowed.some((r) => authz.roles.includes(r))) throw new Error('403');
		return { id: 'u1', roles: authz.roles };
	});
	api.readStats.mockResolvedValue({ hits: 1, misses: 1, sets: 0, deletes: 0, flushes: 0, evictions: 0, entries: 1, max_size: 0 });
	api.listProviders.mockResolvedValue({
		data: [{ name: 'memory-0', kind: 'memory', priority: 0, enabled: true }],
		total_count: 1,
		licensed: false,
		inactive: [{ name: 'redis-1', kind: 'redis', priority: 1, reason: 'provider_limit' }],
	});
	api.listEntries.mockResolvedValue({ data: [], total_count: 0 });
	api.listRules.mockResolvedValue({
		data: [rule],
		total_count: 1,
		licensed: false,
		limits: { rules: { limit: 10, current: 1 } },
	});
});

describe('cache load', () => {
	// The counters and stored keys describe every tenant, so a tenant admin's
	// page never asks for them, and their absence is not an error.
	it('reads the rules and providers for a tenant admin and never the instance counters', async () => {
		const result = (await load(loadEvent(['admin']))) as Loaded;
		expect(api.readStats).not.toHaveBeenCalled();
		expect(api.listEntries).not.toHaveBeenCalled();
		expect(result.gate).toEqual({ state: 'ok' });
		expect(result.superAdmin).toBe(false);
		expect(result.rules.rows).toEqual([rule]);
		expect(result.rules.limit).toEqual({ limit: 10, current: 1 });
		expect(result.rules.licensed).toBe(false);
	});

	it('carries the provider tier and the providers left out with their reasons', async () => {
		const result = (await load(loadEvent(['super_admin']))) as Loaded;
		expect(api.readStats).toHaveBeenCalled();
		expect(result.providersLicensed).toBe(false);
		expect(result.inactive).toEqual([{ name: 'redis-1', kind: 'redis', priority: 1, reason: 'provider_limit' }]);
	});

	it('says a failed rules read failed and keeps the rest of the page', async () => {
		api.listRules.mockRejectedValue(new Error('down'));
		const result = (await load(loadEvent(['admin']))) as Loaded;
		expect(result.gate).toEqual({ state: 'ok' });
		expect(result.rules.gate.state).toBe('error');
		expect(result.providers).toHaveLength(1);
	});

	it('reads a provider list with no tier as unknown rather than as one that needs no license', async () => {
		api.listProviders.mockResolvedValue({ data: [], total_count: 0 });
		const result = (await load(loadEvent(['admin']))) as Loaded;
		expect(result.providersLicensed).toBeNull();
		expect(result.inactive).toEqual([]);
	});
});

describe('cache rule actions', () => {
	it('creates a rule with its tags split and its switch read', async () => {
		api.createRule.mockResolvedValue(rule);
		const out = await actions.createRule(
			formEvent({ pattern: '/api/v1/content/posts/**', ttl_seconds: '300', tags: 'posts, news posts', enabled: 'true' }),
		);
		expect(api.createRule).toHaveBeenCalledWith(expect.anything(), {
			pattern: '/api/v1/content/posts/**',
			ttl_seconds: 300,
			tags: ['posts', 'news'],
			enabled: true,
		});
		expect(out).toEqual({ savedRule: '/api/v1/content/posts/**' });
	});

	it('refuses a pattern outside the content API before the round trip', async () => {
		const out = (await actions.createRule(formEvent({ pattern: '/admin/x', ttl_seconds: '60' }))) as {
			status: number;
		};
		expect(out.status).toBe(400);
		expect(api.createRule).not.toHaveBeenCalled();
	});

	// The ceiling is the plugin's. The page renders its numbers from the
	// refusal, never from a constant of its own.
	it('returns the ceiling refusal with the numbers the plugin sent', async () => {
		api.createRule.mockRejectedValue(
			new ApiError(402, 'cap_exceeded', { error: 'cap_exceeded', cap: 'example.rules', limit: 10, current: 10 }),
		);
		const out = (await actions.createRule(formEvent({ pattern: '/api/v1/content/x', ttl_seconds: '60' }))) as {
			status: number;
			data: { refused: { kind: string; limit: number; current: number } };
		};
		expect(out.status).toBe(402);
		expect(out.data.refused).toMatchObject({ kind: 'cap', limit: 10, current: 10 });
	});

	it('purges one rule, a tag or everything', async () => {
		api.purgeRule.mockResolvedValue(3);
		api.purgeResponses.mockResolvedValue(5);
		expect(await actions.purge(formEvent({ rule: rule.id }))).toEqual({ purged: 3, purgedWhat: 'rule' });
		expect(api.purgeRule).toHaveBeenCalledWith(expect.anything(), rule.id);
		expect(await actions.purge(formEvent({ tag: 'posts' }))).toEqual({ purged: 5, purgedWhat: 'tag posts' });
		expect(api.purgeResponses).toHaveBeenLastCalledWith(expect.anything(), 'posts');
		expect(await actions.purge(formEvent({}))).toEqual({ purged: 5, purgedWhat: 'all' });
		expect(api.purgeResponses).toHaveBeenLastCalledWith(expect.anything(), '');
	});

	it('keeps the instance flush to a super admin', async () => {
		await expect(actions.flush(formEvent({}))).rejects.toThrow('403');
		expect(api.flushAll).not.toHaveBeenCalled();
	});
});
