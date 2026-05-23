import { describe, expect, it, vi } from 'vitest';
import { ApiError, type HttpClient } from '@lyeve-labs/client';
import { ROOTS_QUERY, graphqlGate, introspect, listPersisted, readRoots, togglePersisted } from './graphql';

describe('readRoots', () => {
	it('lists each root type by name, with its arguments', () => {
		const { roots, refused } = readRoots({
			data: {
				__schema: {
					queryType: { fields: [{ name: 'posts', description: 'All posts', args: [{ name: 'limit' }] }, { name: 'authors', args: [] }] },
					mutationType: { fields: [{ name: 'createPost', args: [{ name: 'input' }] }] },
					subscriptionType: null,
				},
			},
		});
		expect(refused).toBeNull();
		expect(roots?.query.map((f) => f.name)).toEqual(['authors', 'posts']);
		expect(roots?.query[1]).toEqual({ name: 'posts', description: 'All posts', args: ['limit'] });
		expect(roots?.mutation).toHaveLength(1);
		expect(roots?.subscription).toEqual([]);
	});

	it('reports a refused introspection rather than an empty schema', () => {
		expect(readRoots({ errors: [{ message: 'introspection is disabled' }] })).toEqual({ roots: null, refused: 'introspection is disabled' });
		expect(readRoots({}).refused).toBe('The schema was not returned.');
	});
});

describe('the plugin calls', () => {
	it('introspects with the roots query and lists the allowlist at the collection path', async () => {
		const post = vi.fn(async () => ({ data: { __schema: { queryType: { fields: [] } } } }));
		const get = vi.fn(async () => ({ data: [{ query_hash: 'h' }], total: 1 }));
		const patch = vi.fn(async () => ({ enabled: false }));
		const client = { get, post, patch, put: vi.fn(), delete: vi.fn() } as unknown as HttpClient;

		await introspect(client);
		expect(post).toHaveBeenCalledWith('/api/v1/graphql', { query: ROOTS_QUERY, operationName: 'Roots' });
		expect((await listPersisted(client)).total).toBe(1);
		expect(get).toHaveBeenCalledWith('/api/admin/graphql/persisted-queries?limit=200');
		await togglePersisted(client, 'a/b');
		expect(patch).toHaveBeenCalledWith('/api/admin/graphql/persisted-queries/a%2Fb/toggle', {});
	});

	it('names a locked and an absent plugin apart from a failure', () => {
		expect(graphqlGate(new ApiError(402, 'payment required'))).toEqual({ state: 'locked', upgradeUrl: '' });
		expect(graphqlGate(new ApiError(404, 'not found'))).toEqual({ state: 'absent' });
		expect(graphqlGate(new Error('boom')).state).toBe('error');
	});
});
