import { beforeEach, describe, expect, it, vi } from 'vitest';

const engine = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
const authz = vi.hoisted(() => ({ roles: ['admin'] as string[] }));
vi.mock('$lib/server/authz', async (importOriginal) => ({
	...((await importOriginal()) as object),
	authedClient: vi.fn(() => engine),
	requireRole: vi.fn(async (_event: unknown, allowed: string[]) => {
		if (!allowed.some((r) => authz.roles.includes(r))) throw new Error('403');
		return { id: 'u1', roles: authz.roles };
	}),
}));

import { actions, load } from './+page.server';

function loadEvent(query = '') {
	return {
		url: new URL(`http://localhost/admin/observability/idempotency${query}`),
		parent: async () => ({ plugins: { state: 'named', running: ['idempotency'], withheld: [] } }),
	} as never;
}

function actionEvent(fields: Record<string, string>) {
	const data = new FormData();
	for (const [k, v] of Object.entries(fields)) data.set(k, v);
	return { request: { formData: async () => data } } as never;
}

beforeEach(() => {
	vi.clearAllMocks();
	authz.roles = ['admin'];
});

describe('releasing a key', () => {
	// The plugin admits any admin to the release. Asking for super admin
	// refused a reader the engine would have answered.
	it('lets an admin release a key, as the plugin does', async () => {
		engine.delete.mockResolvedValue(undefined);
		const out = await actions.release(actionEvent({ key: 'order-17' }));
		expect(out).toEqual({ released: 'order-17' });
		expect(engine.delete).toHaveBeenCalledWith('/api/admin/idempotency/order-17');
	});

	it('refuses a reader who is not an admin', async () => {
		authz.roles = ['editor'];
		await expect(actions.release(actionEvent({ key: 'order-17' }))).rejects.toThrow('403');
	});
});

describe('the key list', () => {
	it('sends an offset past the end back to the last page', async () => {
		engine.get.mockImplementation(async (url: string) =>
			url.includes('/stats') ? { total: 3, completed: 3, in_flight: 0 } : { data: [], total_count: 60 },
		);
		await expect(load(loadEvent('?limit=50&offset=500'))).rejects.toMatchObject({
			status: 307,
			location: expect.stringContaining('offset=50'),
		});
	});
});
