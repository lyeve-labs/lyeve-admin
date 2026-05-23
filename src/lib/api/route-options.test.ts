import { describe, expect, it } from 'vitest';
import { routeOptions } from './route-options';

describe('routeOptions', () => {
	it('offers every documented route as a pattern, after the catch-all', () => {
		const opts = routeOptions({
			paths: {
				'/api/v1/realtime/events': { get: { summary: 'Stream events', tags: ['Plugin / realtime'] } },
				'/api/checkout': { post: { summary: 'Checkout', tags: ['Flow endpoints'] } },
				'/api/v1/content/{schema}': { get: { summary: 'List entries' }, post: { summary: 'Create an entry' } },
			},
		});
		expect(opts.map((o) => o.value)).toEqual([
			'*',
			'POST /api/checkout',
			'GET /api/v1/content/{schema}',
			'POST /api/v1/content/{schema}',
			'GET /api/v1/realtime/events',
		]);
		expect(opts.find((o) => o.value === 'POST /api/checkout')?.keywords).toEqual(['Checkout', 'Flow endpoints']);
	});

	it('still offers the catch-all when the document cannot be read', () => {
		expect(routeOptions(null)).toEqual([{ value: '*', label: '* (every request)' }]);
	});
});
