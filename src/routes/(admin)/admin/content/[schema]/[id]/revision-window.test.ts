import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Cookies } from '@sveltejs/kit';
import { ApiError } from '@lyeve-labs/client';

const engine = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock('$lib/server/authz', async (importOriginal) => ({
	...((await importOriginal()) as object),
	requireUser: vi.fn(async () => ({ id: 'u1', roles: ['admin'] }) as never),
	authedClient: vi.fn(() => engine),
}));
vi.mock('@lyeve-labs/client-rest', () => ({
	getSchema: vi.fn(async () => ({ name: 'article', fields: [] })),
}));

import { actions, load } from './+page.server';

type Failure = { status: number; data: Record<string, unknown> };
type Loaded = { revisions: { revision_num: number }[]; revisionWindow: { hiddenOlder: number; windowDays: number | null } };

const REFUSED = new ApiError(402, 'payment_required', {
	error: 'payment_required',
	plugin: 'content',
	feature: 'feature:example_feature',
});

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

async function loadWith(revisions: unknown): Promise<Loaded> {
	const fetch = vi.fn(async (path: string) => {
		if (String(path).includes('/revisions')) return json(revisions);
		return json({ id: 'e1', created_at: '', updated_at: '', title: 'One', body: {}, status: 'draft' });
	}) as unknown as typeof globalThis.fetch;
	return (await load({
		fetch,
		cookies: { get: vi.fn(() => 'token') } as unknown as Cookies,
		url: new URL('http://localhost/admin/content/article/e1'),
		params: { schema: 'article', id: 'e1' },
		parent: async () => ({ plugins: { state: 'named', running: [], withheld: [] }, user: { id: 'u1', roles: ['admin'] } }),
	} as never)) as unknown as Loaded;
}

function actionEvent(fields: Record<string, string>) {
	const data = new FormData();
	for (const [k, v] of Object.entries(fields)) data.set(k, v);
	return { request: { formData: async () => data }, params: { schema: 'article', id: 'e1' } } as never;
}

beforeEach(() => vi.clearAllMocks());

describe('the revision window', () => {
	it('carries how many older revisions the plugin left out and over what window', async () => {
		const out = await loadWith({
			data: [{ id: 'r9', revision_num: 9, created_at: '2026-10-01T00:00:00Z', title: 'One' }],
			total_count: 1,
			hidden_older: 8,
			window_days: 30,
		});
		expect(out.revisions.map((r) => r.revision_num)).toEqual([9]);
		expect(out.revisionWindow).toEqual({ hiddenOlder: 8, windowDays: 30 });
	});

	it('reads a list with every revision as one with nothing hidden', async () => {
		const out = await loadWith({ data: [], total_count: 0, hidden_older: 0, window_days: null });
		expect(out.revisionWindow).toEqual({ hiddenOlder: 0, windowDays: null });
	});

	it('reads a plugin that sends neither field as one with nothing hidden', async () => {
		const out = await loadWith({ data: [], total_count: 0 });
		expect(out.revisionWindow).toEqual({ hiddenOlder: 0, windowDays: null });
	});
});

describe('opening an older revision', () => {
	it('reads the revision by its number', async () => {
		engine.get.mockResolvedValue({ id: 'r8', revision_num: 8, created_at: '2026-08-01T00:00:00Z', title: 'Older' });
		const out = (await actions.openRevision(actionEvent({ rev_num: '8' }))) as { openedRevision: { revision_num: number; data: Record<string, unknown> } };
		expect(engine.get).toHaveBeenCalledWith('/api/admin/content/e1/revisions/8');
		expect(out.openedRevision.revision_num).toBe(8);
		expect(out.openedRevision.data.title).toBe('Older');
	});

	it('returns the refusal for a revision outside the window, for the panel to render', async () => {
		engine.get.mockRejectedValue(REFUSED);
		const out = (await actions.openRevision(actionEvent({ rev_num: '8' }))) as Failure;
		expect(out.status).toBe(402);
		expect(out.data).toMatchObject({ revision: true, refused: { kind: 'feature', feature: 'example-feature' } });
	});

	it('refuses a revision number that is not one, without a request', async () => {
		const out = (await actions.openRevision(actionEvent({ rev_num: 'x' }))) as Failure;
		expect(out.status).toBe(400);
		expect(engine.get).not.toHaveBeenCalled();
	});

	it('returns the refusal for restoring a revision outside the window', async () => {
		engine.post.mockRejectedValue(REFUSED);
		const out = (await actions.restore(actionEvent({ rev_num: '3' }))) as Failure;
		expect(engine.post).toHaveBeenCalledWith('/api/admin/content/e1/rollback', { to_revision: 3 });
		expect(out.status).toBe(402);
		expect(out.data).toMatchObject({ revision: true, refused: { kind: 'feature' } });
	});
});
