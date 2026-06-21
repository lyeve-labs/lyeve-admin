import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@lyeve-labs/client';
import { CatalogError } from '$lib/api/assist';
import { assistRefusal, catalogFor, refusalStatus } from './flow-assist';

describe('assistRefusal', () => {
	it('maps the two gates, the validator and the rest', () => {
		expect(assistRefusal(new ApiError(402, 'ai is not enabled'))).toEqual({ state: 'locked' });
		expect(assistRefusal(new ApiError(404, 'not found'))).toEqual({ state: 'off' });
		expect(assistRefusal(new ApiError(503, 'flow validator is not registered'))).toEqual({ state: 'unavailable', message: 'flow validator is not registered' });
		expect(assistRefusal(new ApiError(503, ''))).toEqual({ state: 'unavailable', message: 'The flow validator is not available on this engine.' });
		expect(assistRefusal(new ApiError(422, 'prompt is too long'))).toEqual({ state: 'error', message: 'prompt is too long' });
		expect(assistRefusal(new ApiError(500, 'pq: connection refused'))).toEqual({ state: 'error', message: 'The assistant did not answer. Try again.' });
		expect(assistRefusal(new Error('boom'))).toEqual({ state: 'error', message: 'The assistant did not answer. Try again.' });
	});

	it('reads a missing catalog route as unavailable and a 402 on it as locked', () => {
		expect(assistRefusal(new CatalogError(404, 'not found'))).toMatchObject({ state: 'unavailable' });
		expect(assistRefusal(new CatalogError(402, 'ai is not enabled'))).toEqual({ state: 'locked' });
		expect(assistRefusal(new CatalogError(500, 'pq: x'))).toEqual({ state: 'error', message: 'The node catalog could not be read.' });
	});

	it('names a timed-out model', () => {
		const err = new Error('timed out');
		err.name = 'TimeoutError';
		expect(assistRefusal(err).state).toBe('error');
		expect((assistRefusal(err) as { message: string }).message).toContain('too long');
	});

	it('answers each refusal with its status', () => {
		expect(refusalStatus({ state: 'locked' })).toBe(402);
		expect(refusalStatus({ state: 'off' })).toBe(404);
		expect(refusalStatus({ state: 'unavailable', message: '' })).toBe(503);
		expect(refusalStatus({ state: 'error', message: '' })).toBe(400);
	});
});

describe('catalogFor', () => {
	it('reads the catalog once per request and again for the next', async () => {
		const fetch = vi.fn(async () => new Response('# Nodes', { status: 200 }));
		const cookies = { get: () => 'tok' };
		const first = { request: new Request('http://localhost/x'), fetch: fetch as unknown as typeof globalThis.fetch, cookies };
		expect(await Promise.all([catalogFor(first), catalogFor(first)])).toEqual(['# Nodes', '# Nodes']);
		expect(fetch).toHaveBeenCalledTimes(1);
		const second = { ...first, request: new Request('http://localhost/y') };
		expect(await catalogFor(second)).toBe('# Nodes');
		expect(fetch).toHaveBeenCalledTimes(2);
	});
});
