import { describe, expect, it, vi } from 'vitest';
import { ApiError, type HttpClient } from '@lyeve-labs/client';
import type { PluginStatusReport } from '@lyeve-labs/client-rest';
import { readRunningPlugins, runningFromStatus, RUNNING_PLUGINS_URL } from './plugins-running';

function client(get: () => Promise<unknown>): HttpClient & { get: ReturnType<typeof vi.fn> } {
	return { get: vi.fn(get) } as unknown as HttpClient & { get: ReturnType<typeof vi.fn> };
}

describe('readRunningPlugins', () => {
	it('reads both lists from the route every role may read', async () => {
		const c = client(async () => ({ plugins: ['content', 'media'], withheld: ['search'] }));
		expect(await readRunningPlugins(c)).toEqual({ plugins: ['content', 'media'], withheld: ['search'] });
		expect(c.get).toHaveBeenCalledWith(RUNNING_PLUGINS_URL);
	});

	it('reads a missing or malformed list as empty, never as null', async () => {
		expect(await readRunningPlugins(client(async () => ({})))).toEqual({ plugins: [], withheld: [] });
		expect(await readRunningPlugins(client(async () => null))).toEqual({ plugins: [], withheld: [] });
		expect(await readRunningPlugins(client(async () => ({ plugins: ['media', 7], withheld: 'x' })))).toEqual({
			plugins: ['media'],
			withheld: [],
		});
	});

	it('tells an engine without the route apart from a failed read', async () => {
		expect(await readRunningPlugins(client(async () => Promise.reject(new ApiError(404, 'not found'))))).toBe('missing');
		expect(await readRunningPlugins(client(async () => Promise.reject(new ApiError(503, 'unavailable'))))).toBe('failed');
		expect(await readRunningPlugins(client(async () => Promise.reject(new Error('network'))))).toBe('failed');
	});
});

describe('runningFromStatus', () => {
	it('keeps the compiled plugins that run or start on first use, sorted, and moves the withheld ones aside', () => {
		const report = {
			compiled: [],
			entitled: [],
			plugins: [
				{ name: 'search', compiled: true, entitled: true, requested: true, active: true, phase: 'running' },
				{ name: 'audit', compiled: true, entitled: true, requested: true, active: false, phase: 'lazy' },
				{ name: 'media', compiled: true, entitled: true, requested: true, active: true, phase: 'running' },
				{ name: 'saml', compiled: true, entitled: false, requested: true, active: false, phase: 'registered' },
				{ name: 'scim', compiled: true, entitled: true, requested: true, active: false, phase: 'failed' },
				{ name: 'grpc', compiled: false, entitled: true, requested: true, active: false, phase: 'registered' },
			],
		} as unknown as PluginStatusReport;
		expect(runningFromStatus(report, ['media'])).toEqual({ plugins: ['audit', 'search'], withheld: ['media'] });
	});
});
