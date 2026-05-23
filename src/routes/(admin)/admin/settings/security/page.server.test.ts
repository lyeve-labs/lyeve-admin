import { describe, it, expect, vi, beforeEach } from 'vitest';

const engine = vi.hoisted(() => ({ get: vi.fn() }));
const gate = vi.hoisted(() => ({ requireRole: vi.fn() }));

vi.mock('$lib/server/authz', () => ({
	requireRole: gate.requireRole,
	authedClient: vi.fn(() => engine),
}));
vi.mock('@lyeve-labs/client', () => ({
	createClient: vi.fn(() => engine),
	ApiError: class ApiError extends Error {
		status: number;
		constructor(status: number, message: string) {
			super(message);
			this.status = status;
		}
	},
}));

import { load } from './+page.server';
import { ApiError } from '@lyeve-labs/client';

const event = {} as never;
const report = {
	checked_at: '2026-09-13T22:00:00Z',
	failures: 1,
	controls: [{ control: 'waf', status: 'FAIL', detail: 'not wired', remedy: 'Enable the waf plugin.' }],
};

beforeEach(() => {
	vi.clearAllMocks();
	gate.requireRole.mockResolvedValue({ id: 'u1', roles: ['super_admin'] });
});

describe('security load', () => {
	it('asks the engine for the report as super_admin', async () => {
		engine.get.mockResolvedValue(report);
		const data = await load(event);
		expect(gate.requireRole).toHaveBeenCalledWith(event, ['super_admin']);
		expect(engine.get).toHaveBeenCalledWith('/api/admin/security/controls');
		expect(data).toEqual({ report, unavailable: null });
	});

	it('refuses a lower role before reading anything', async () => {
		gate.requireRole.mockRejectedValue(new Error('403'));
		await expect(load(event)).rejects.toThrow('403');
		expect(engine.get).not.toHaveBeenCalled();
	});

	it('tells an engine without the report apart from a dead one', async () => {
		// A 404 is an engine without the endpoint, which the page says one way.
		// Anything else is an engine that did not answer.
		engine.get.mockRejectedValue(new ApiError(404, 'not found'));
		expect(await load(event)).toEqual({ report: null, unavailable: 'missing' });
		engine.get.mockRejectedValue(new ApiError(503, 'db down'));
		expect(await load(event)).toEqual({ report: null, unavailable: 'down' });
	});
});
