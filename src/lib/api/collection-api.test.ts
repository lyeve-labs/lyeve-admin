import { describe, expect, it } from 'vitest';
import { collectionRoutes } from './collection-api';
import { curlFor } from './request-preview';

describe('collectionRoutes', () => {
	it('fills the collection into the {schema} family and gates the writes', () => {
		const routes = collectionRoutes('posts');
		expect(routes.every((r) => r.path.startsWith('/api/v1/content/posts'))).toBe(true);
		expect(routes.some((r) => r.path.includes('{schema}'))).toBe(false);
		for (const r of routes) {
			if (r.method === 'GET') expect(r.roles).toBeUndefined();
			else expect(r.roles).toEqual(['editor', 'admin', 'super_admin']);
		}
	});

	it('previews as a request with only the record id left to fill', () => {
		const get = collectionRoutes('posts').find((r) => r.method === 'GET' && r.path.endsWith('/{id}'))!;
		expect(curlFor(get)).toContain(`'http://localhost:3002/api/v1/content/posts/<id>'`);
	});
});
