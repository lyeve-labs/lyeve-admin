import { describe, expect, it, vi } from 'vitest';
import type { HttpClient } from '@lyeve-labs/client';
import {
	isPrivilegedKey,
	keyExpiryProblem,
	keyRoleProblem,
	keyScopeProblem,
	keysUsage,
	limitOrderProblem,
	limitsOf,
	parseLimits,
	privilegedExpiryBounds,
	scopesOf,
	USAGE_IDS_BUDGET,
	usageIdBatches,
} from './api-keys';

function clientReturning(get: ReturnType<typeof vi.fn>): HttpClient {
	return { get } as unknown as HttpClient;
}

describe('keysUsage', () => {
	it('reads a page that fits one URL in one request', async () => {
		const get = vi.fn().mockResolvedValue([{ api_key_id: 'k1', requests: 7 }]);
		const usage = await keysUsage<{ requests: number }>(clientReturning(get), ['k1', 'k2'], '2026-09');
		expect(get).toHaveBeenCalledTimes(1);
		expect(get).toHaveBeenCalledWith('/api/admin/usage/api-keys?ids=k1%2Ck2&period=2026-09');
		expect(usage).toEqual([{ api_key_id: 'k1', requests: 7 }]);
	});

	it('rejects when the read fails, so the page can say the figures are unknown', async () => {
		const get = vi.fn().mockRejectedValue(new Error('down'));
		await expect(keysUsage(clientReturning(get), ['k1'], '2026-09')).rejects.toThrow('down');
	});

	// The most a page asks for is 500 keys, and their ids in one URL run to
	// about 19.5 KB, past the 8 KB request line nginx accepts by default.
	it('splits a full page of ids into reads that each fit an 8 KB request line', async () => {
		const ids = Array.from({ length: 500 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
		const get = vi.fn().mockImplementation(async (path: string) => {
			const batch = new URL(path, 'http://x').searchParams.get('ids')!.split(',');
			return batch.map((id) => ({ api_key_id: id }));
		});
		const usage = await keysUsage<{ api_key_id: string }>(clientReturning(get), ids, '2026-09');
		const paths = get.mock.calls.map(([path]) => path as string);
		expect(paths.length).toBeGreaterThan(1);
		for (const path of paths) expect(`GET ${path} HTTP/1.1`.length).toBeLessThan(8192);
		expect(usage.map((u) => u.api_key_id)).toEqual(ids);
	});
});

describe('usageIdBatches', () => {
	it('keeps every id once and in order, each batch within the budget', () => {
		const ids = Array.from({ length: 400 }, (_, i) => `id-${i}`);
		const batches = usageIdBatches(ids, 100);
		expect(batches.flat()).toEqual(ids);
		for (const b of batches) expect(new URLSearchParams({ ids: b.join(',') }).toString().length - 'ids='.length).toBeLessThanOrEqual(100);
	});
	it('answers one batch for a page that fits and none for no ids', () => {
		expect(usageIdBatches(['k1', 'k2'])).toEqual([['k1', 'k2']]);
		expect(usageIdBatches([])).toEqual([]);
		expect(USAGE_IDS_BUDGET).toBeLessThan(8192);
	});
});

describe('privileged key expiry', () => {
	const today = new Date(2026, 8, 26);
	it('needs no expiry for an editor key', () => {
		expect(keyExpiryProblem(['editor'], '', today)).toBe('');
	});
	it('needs one within 90 days for an admin or super admin key', () => {
		expect(keyExpiryProblem(['admin'], '', today)).toContain('needs an expiry');
		expect(keyExpiryProblem(['viewer', 'super_admin'], '2027-06-01', today)).toContain('at most 90 days');
		expect(keyExpiryProblem(['admin'], '2026-09-26', today)).toContain('after today');
		expect(keyExpiryProblem(['admin'], '2026-12-24', today)).toBe('');
		expect(keyExpiryProblem(['admin'], '2026-12-25', today)).toContain('at most 90 days');
	});
	it('bounds the picker from tomorrow to 90 days out', () => {
		expect(privilegedExpiryBounds(today)).toEqual({ min: '2026-09-27', max: '2026-12-24' });
		expect(isPrivilegedKey(['editor'])).toBe(false);
	});
});

describe('key scopes', () => {
	it.each([
		{ roles: ['viewer'], scopes: [], problem: true },
		{ roles: ['editor'], scopes: ['content:write'], problem: false },
		{ roles: ['admin'], scopes: [], problem: false },
		{ roles: [], scopes: [], problem: true },
	])('roles $roles with scopes $scopes: problem $problem', ({ roles, scopes, problem }) => {
		expect(keyScopeProblem(roles, scopes) !== '').toBe(problem);
	});
});

describe('key roles', () => {
	it.each([
		{ roles: ['viewer'], scopes: ['content:read'], problem: false },
		{ roles: ['viewer'], scopes: ['content:create'], problem: true },
		{ roles: [], scopes: ['content.posts:delete'], problem: true },
		{ roles: ['viewer'], scopes: ['flows.sync:create'], problem: false },
		{ roles: ['editor'], scopes: ['content:update'], problem: false },
		{ roles: ['admin'], scopes: ['content.posts:create'], problem: false },
	])('roles $roles with scopes $scopes: problem $problem', ({ roles, scopes, problem }) => {
		expect(keyRoleProblem(roles, scopes) !== '').toBe(problem);
	});
});

describe('scopesOf', () => {
	it.each([
		{ key: { scopes: ['content:read'] }, want: ['content:read'] },
		{ key: { scopes: [] }, want: [] },
		{ key: {}, want: [] },
		{ key: { scopes: null }, want: [] },
	])('reads $key', ({ key, want }) => {
		expect(scopesOf(key as never)).toEqual(want);
	});
});

describe('request limits', () => {
	function form(fields: Record<string, string>): FormData {
		const data = new FormData();
		for (const [k, v] of Object.entries(fields)) data.append(k, v);
		return data;
	}

	it('reads blank as no ceiling', () => {
		expect(parseLimits(form({}))).toEqual({ limits: { hourly_limit: 0, daily_limit: 0, monthly_limit: 0 } });
		expect(parseLimits(form({ hourly_limit: '60', daily_limit: '', monthly_limit: '9000' }))).toEqual({
			limits: { hourly_limit: 60, daily_limit: 0, monthly_limit: 9000 },
		});
	});

	it('names each field that is not a whole number', () => {
		expect(parseLimits(form({ hourly_limit: '1.5', daily_limit: '-1' }))).toEqual({
			fields: {
				hourly_limit: 'A whole number of requests, or 0 for no ceiling',
				daily_limit: 'A whole number of requests, or 0 for no ceiling',
			},
		});
	});

	it.each([
		{ l: { hourly_limit: 10, daily_limit: 100, monthly_limit: 1000 }, field: null },
		{ l: { hourly_limit: 101, daily_limit: 100, monthly_limit: 0 }, field: 'hourly_limit' },
		{ l: { hourly_limit: 0, daily_limit: 1001, monthly_limit: 1000 }, field: 'daily_limit' },
		{ l: { hourly_limit: 1001, daily_limit: 0, monthly_limit: 1000 }, field: 'hourly_limit' },
		{ l: { hourly_limit: 500, daily_limit: 0, monthly_limit: 0 }, field: null },
	])('refuses a window above a longer one: $l', ({ l, field }) => {
		expect(limitOrderProblem(l)?.field ?? null).toBe(field);
	});

	it('reads a key from an engine that sends no window ceilings as none', () => {
		expect(limitsOf({ monthly_limit: 5 } as never)).toEqual({ hourly_limit: 0, daily_limit: 0, monthly_limit: 5 });
		expect(limitsOf({ monthly_limit: 5, daily_limit: 3, hourly_limit: 1 } as never)).toEqual({
			hourly_limit: 1,
			daily_limit: 3,
			monthly_limit: 5,
		});
	});
});
