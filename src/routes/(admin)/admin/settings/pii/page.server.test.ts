import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@lyeve-labs/client';

const api = vi.hoisted(() => ({
	createRule: vi.fn(),
	getRules: vi.fn(),
	listAccessLog: vi.fn(),
}));

vi.mock('$lib/api/pii-mask', async (importOriginal) => ({
	...((await importOriginal()) as object),
	...api,
}));

vi.mock('$lib/server/authz', () => ({
	authedClient: vi.fn(() => ({})),
	requireRole: vi.fn(async () => ({ id: 'u1', roles: ['admin'] })),
}));

import { actions, load } from './+page.server';

function formEvent(fields: Record<string, string>) {
	const body = new FormData();
	for (const [k, v] of Object.entries(fields)) body.set(k, v);
	return { request: new Request('http://admin/x', { method: 'POST', body }), cookies: {}, fetch: vi.fn() } as never;
}

function loadEvent(query = '') {
	return {
		url: new URL(`http://admin.test/admin/settings/pii${query}`),
		depends: vi.fn(),
		parent: async () => ({ plugins: null }),
	} as never;
}

beforeEach(() => {
	vi.clearAllMocks();
	api.getRules.mockResolvedValue({ presets: [], mask_tags: {} });
});

describe('pii rule actions', () => {
	// The page reads the failure from the error key. A bare string there left
	// every refused save without a word on screen.
	it('returns a refused save under the key the page reads', async () => {
		api.createRule.mockRejectedValue(new ApiError(400, 'pattern does not compile'));
		const out = (await actions.create(formEvent({ name: 'X', pattern: '(', replacement: '*' }))) as {
			status: number;
			data: { error: string };
		};
		expect(out.status).toBe(422);
		expect(out.data.error).toBe('pattern does not compile');
	});
});

describe('pii load', () => {
	it('sends an access log page past the end back to the last page', async () => {
		api.listAccessLog.mockResolvedValue({ data: [], total_count: 70 });
		await expect(load(loadEvent('?offset=300'))).rejects.toMatchObject({
			status: 307,
			location: '/admin/settings/pii?offset=50',
		});
	});
});
