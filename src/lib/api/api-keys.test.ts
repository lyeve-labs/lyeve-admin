import { describe, expect, it, vi } from 'vitest';
import type { HttpClient } from '@lyeve-labs/client';
import {
	isPrivilegedKey,
	keyExpiryProblem,
	keyScopeProblem,
	keyUsage,
	limitOrderProblem,
	limitsOf,
	parseLimits,
	privilegedExpiryBounds,
	scopesOf,
} from './api-keys';

function clientReturning(get: ReturnType<typeof vi.fn>): HttpClient {
	return { get } as unknown as HttpClient;
}

describe('keyUsage', () => {
	it('reads the usage plugin, which meters the key', async () => {
		const get = vi.fn().mockResolvedValue({ requests: 7 });
		const usage = await keyUsage<{ requests: number }>(clientReturning(get), 'k/1', '2026-09');
		expect(get).toHaveBeenCalledWith('/api/admin/usage/api-key/k%2F1?period=2026-09');
		expect(usage).toEqual({ requests: 7 });
	});

	it('answers null when the read fails', async () => {
		const get = vi.fn().mockRejectedValue(new Error('404'));
		await expect(keyUsage(clientReturning(get), 'k1', '2026-09')).resolves.toBeNull();
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
