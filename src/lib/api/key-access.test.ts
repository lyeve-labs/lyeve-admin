import { describe, expect, it, vi } from 'vitest';
import type { HttpClient } from '@lyeve-labs/client';
import {
	accessProblem,
	accessSchemas,
	accessScopes,
	cleanScopes,
	contentSummary,
	defaultAccess,
	describeScopes,
	fetchKeyScopeCatalog,
	groupCatalog,
	namesProblem,
	parseNames,
	type KeyAccess,
	type KeyScopeCatalog,
} from './key-access';

const catalog: KeyScopeCatalog = {
	actions: ['read', 'create', 'update', 'delete'],
	routes: [
		{ method: 'GET', path: '/api/v1/content/{schema}', resource: 'content', name: '{schema}', action: 'read', scope: 'content.{schema}:read', owner: 'engine' },
		{ method: 'GET', path: '/api/v1/schemas', resource: 'schemas', action: 'read', scope: 'schemas:read', owner: 'engine' },
		{ method: 'POST', path: '/api/v1/flows/{slug}', resource: 'flows', name: '{slug}', action: 'create', scope: 'flows.{slug}:create', owner: 'flow' },
		{ method: 'GET', path: '/api/v1/flows/{slug}', resource: 'flows', name: '{slug}', action: 'read', scope: 'flows.{slug}:read', owner: 'flow' },
		{ method: 'POST', path: '/api/v1/graphql', resource: 'graphql', action: 'read', scope: 'graphql:read', owner: 'graphql', declared: true },
		{ method: 'GET', path: '/api/v1/recommendations/feed', resource: 'recommendations', name: 'feed', action: 'read', scope: 'recommendations.feed:read', owner: 'recommendations' },
	],
};

function access(over: Partial<KeyAccess>): KeyAccess {
	return { ...defaultAccess(), ...over };
}

describe('groupCatalog', () => {
	it('groups the routes by resource, leaving out what the drawer handles itself', () => {
		const groups = groupCatalog(catalog);
		expect(groups.map((g) => g.resource)).toEqual(['flows', 'graphql', 'recommendations']);
		const flows = groups[0];
		expect(flows.label).toBe('Flows');
		expect(flows.actions).toEqual(['read', 'create']);
		expect(flows.nameParam).toBe('{slug}');
		expect(groups[1].label).toBe('GraphQL');
		expect(groups[1].nameParam).toBeNull();
		expect(groups[2].nameParam).toBeNull();
	});

	it('answers nothing for an engine with no catalog', () => {
		expect(groupCatalog(null)).toEqual([]);
	});
});

describe('accessScopes', () => {
	it('starts a key able to read every schema and discover them', () => {
		expect(accessScopes(defaultAccess())).toEqual(['content:read', 'schemas:read']);
		expect(accessSchemas(defaultAccess())).toEqual([]);
	});

	it('holds a key to the schemas and actions chosen for each', () => {
		const a = access({
			contentMode: 'chosen',
			perSchema: { posts: ['create', 'read'], pages: ['read'], drafts: [] },
			discoverSchemas: false,
		});
		expect(accessScopes(a)).toEqual(['content.pages:read', 'content.posts:read', 'content.posts:create']);
		expect(accessSchemas(a)).toEqual(['pages', 'posts']);
		expect(contentSummary(a)).toBe('2 schemas');
	});

	it('names each endpoint a resource is held to, or the whole resource', () => {
		const a = access({
			contentActions: [],
			discoverSchemas: false,
			resources: {
				flows: { actions: ['create'], names: 'order-sync, Refund-Hook, order-sync' },
				graphql: { actions: ['read'], names: '' },
				search: { actions: [], names: 'x' },
			},
		});
		expect(accessScopes(a)).toEqual(['flows.order-sync:create', 'flows.refund-hook:create', 'graphql:read']);
	});

	it('gives a chosen-schema key nothing on content when no schema is ticked', () => {
		const a = access({ contentMode: 'chosen', perSchema: {}, discoverSchemas: false });
		expect(accessScopes(a)).toEqual([]);
		expect(contentSummary(a)).toBe('Off');
	});
});

describe('cleanScopes', () => {
	it('keeps the scopes the console issues, lower-cased, once each', () => {
		expect(
			cleanScopes(['Content.Posts:Read', 'content.posts:read', 'flows:create', '*:*', 'content:*', 'content', 'a.b.c:read', 'x:']),
		).toEqual(['content.posts:read', 'flows:create']);
	});
});

describe('describeScopes', () => {
	it('puts one resource on each line', () => {
		expect(describeScopes(['content.posts:create', 'content.posts:read', 'schemas:read'])).toEqual([
			'content.posts: read, create',
			'schemas: read',
		]);
	});
});

describe('parseNames', () => {
	it('trims, lower-cases and drops repeats', () => {
		expect(parseNames(' A, b ,,a ')).toEqual(['a', 'b']);
	});
});

describe('fetchKeyScopeCatalog', () => {
	it('reads the engine catalog', async () => {
		const get = vi.fn().mockResolvedValue(catalog);
		await expect(fetchKeyScopeCatalog({ get } as unknown as HttpClient)).resolves.toBe(catalog);
		expect(get).toHaveBeenCalledWith('/api/admin/api-key-scopes');
	});

	it('answers null from an engine that does not serve one', async () => {
		const get = vi.fn().mockRejectedValue(new Error('404'));
		await expect(fetchKeyScopeCatalog({ get } as unknown as HttpClient)).resolves.toBeNull();
	});
});

describe('namesProblem', () => {
	it('accepts names a path segment can hold', () => {
		expect(namesProblem('order-sync, refund_hook, v2')).toBe('');
		expect(namesProblem('')).toBe('');
	});

	it('names each value that cannot be part of a scope', () => {
		const msg = namesProblem('order sync, ok, a.b');
		expect(msg).toContain('"order sync"');
		expect(msg).toContain('"a.b"');
		expect(msg).not.toContain('"ok"');
	});

	it('holds the form only for a group that grants something', () => {
		expect(accessProblem(access({ resources: { flows: { actions: ['create'], names: 'a b' } } }))).toBe(true);
		expect(accessProblem(access({ resources: { flows: { actions: [], names: 'a b' } } }))).toBe(false);
	});
});
