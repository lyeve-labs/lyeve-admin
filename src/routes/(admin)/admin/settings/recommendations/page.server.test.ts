import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@lyeve-labs/client';

const engine = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock('$lib/server/authz', async (importOriginal) => ({
	...((await importOriginal()) as object),
	authedClient: vi.fn(() => engine),
	requireRole: vi.fn(async () => ({ id: 'u1', roles: ['super_admin'] })),
}));

import { actions } from './+page.server';

type Failure = { status: number; data: Record<string, unknown> };

const READER = '24d6560b-540e-47b6-8957-59934db4021d';

function actionEvent(fields: Record<string, string>) {
	const data = new FormData();
	for (const [k, v] of Object.entries(fields)) data.set(k, v);
	return { request: { formData: async () => data } } as never;
}

beforeEach(() => vi.clearAllMocks());

describe('the per-reader preview', () => {
	it('generates the feed of the id posted and reads the entries the plugin answers', async () => {
		const entry = { id: 'f1', user_id: READER, content_id: 'c1', score: 0.5, source: 'trending', created_at: '' };
		engine.post.mockResolvedValue({ entries: [entry], total: 1 });
		const out = await actions.preview(actionEvent({ user_id: ` ${READER} ` }));
		expect(engine.post).toHaveBeenCalledWith(`/api/admin/recommendations/generate-feed/${READER}`, {});
		expect(out).toEqual({ previewFor: READER, feed: [entry] });
	});

	it('refuses what is not a user id before asking the plugin', async () => {
		const out = (await actions.preview(actionEvent({ user_id: 'mira@example.com' }))) as Failure;
		expect(out.status).toBe(400);
		expect(String(out.data.error)).toContain('not a user id');
		expect(engine.post).not.toHaveBeenCalled();
	});

	it('asks for a reader when none was given', async () => {
		const out = (await actions.preview(actionEvent({ user_id: '' }))) as Failure;
		expect(out.status).toBe(400);
		expect(String(out.data.error)).toContain('Name the user');
	});

	it('keeps a refusal as a failure', async () => {
		engine.post.mockRejectedValue(new ApiError(503, 'failed to generate feed', {}));
		const out = (await actions.preview(actionEvent({ user_id: READER }))) as Failure;
		expect(out.status).toBe(400);
	});
});
