import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@lyeve-labs/client';

const engine = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock('$lib/server/authz', () => ({
	authedClient: vi.fn(() => engine),
	requireUser: vi.fn(async () => ({ id: 'u1', roles: ['admin'] })),
}));

import { actions, load } from './+page.server';

function event(form: Record<string, string> = {}) {
	const data = new FormData();
	for (const [k, v] of Object.entries(form)) data.set(k, v);
	return { params: { id: 'r1' }, request: { formData: async () => data } } as never;
}

const release = {
	id: 'r1',
	name: 'Launch',
	status: 'draft',
	item_count: 1,
	items: [{ entry_id: 'e1', action: 'publish', added_by: 'u1', created_at: '' }],
};

beforeEach(() => vi.clearAllMocks());

describe('release load', () => {
	it('names each entry from the entry itself and reads the conflicts', async () => {
		engine.get.mockImplementation(async (url: string) => {
			if (url.endsWith('/conflicts')) return { data: [{ entry_id: 'e1', kind: 'other_release', detail: '' }] };
			if (url === '/api/admin/content/e1') return { title: 'Hello', schema: 'posts', status: 'draft' };
			return release;
		});
		const out = (await load(event())) as Record<string, unknown>;
		expect(out.labels).toEqual({ e1: { title: 'Hello', schema: 'posts', status: 'draft' } });
		expect(out.conflicts).toHaveLength(1);
		expect(out.conflictsRead).toBe(true);
	});

	it('answers 404 for a release that is not there', async () => {
		engine.get.mockRejectedValue(new ApiError(404, 'release not found'));
		await expect(load(event())).rejects.toMatchObject({ status: 404 });
	});
});

describe('release actions', () => {
	it('returns the conflicts a refused publish carried', async () => {
		const conflicts = [{ entry_id: 'e1', kind: 'entry_schedule', detail: 'publish_at' }];
		engine.post.mockRejectedValue(new ApiError(409, 'the release has conflicts with other schedules', { error: 'x', conflicts }));
		const out = (await actions.publish(event())) as { status: number; data: Record<string, unknown> };
		expect(out.status).toBe(409);
		expect(out.data.conflicts).toEqual(conflicts);
	});

	it('schedules at the UTC instant the browser sent', async () => {
		engine.post.mockResolvedValue(release);
		await actions.schedule(event({ publish_at: '2027-01-02T03:04:00.000Z' }));
		expect(engine.post).toHaveBeenCalledWith('/api/admin/content/releases/r1/schedule', { publish_at: '2027-01-02T03:04:00.000Z' });
	});

	it('renders a refused entry write as a refusal', async () => {
		engine.post.mockRejectedValue(
			new ApiError(402, 'payment_required', { error: 'payment_required', plugin: 'example', feature: 'feature:example_capability' }),
		);
		const out = (await actions.addItem(event({ entry_id: 'e2', action: 'publish' }))) as { status: number; data: Record<string, unknown> };
		expect(out.status).toBe(402);
		expect(out.data.refused).toMatchObject({ kind: 'feature', feature: 'example-capability' });
	});

	it('removes an entry by its id', async () => {
		engine.delete.mockResolvedValue(release);
		await actions.removeItem(event({ entry_id: 'e1' }));
		expect(engine.delete).toHaveBeenCalledWith('/api/admin/content/releases/r1/items/e1');
	});
});
