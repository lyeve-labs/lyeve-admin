import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@lyeve-labs/client';

const engine = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock('$lib/server/authz', async (importOriginal) => ({
	...((await importOriginal()) as object),
	authedClient: vi.fn(() => engine),
	requireRole: vi.fn(async () => ({ id: 'u1', roles: ['admin'] })),
}));
vi.mock('@lyeve-labs/client-rest', () => ({ getSchemas: vi.fn(async () => [{ name: 'article' }]) }));

import { actions, load } from './+page.server';
import type { ReviewsPage } from './+page.server';

type Failure = { status: number; data: Record<string, unknown> };

function loadEvent() {
	return {
		url: new URL('http://localhost/admin/reviews'),
		parent: async () => ({
			user: { id: 'u1', roles: ['admin'] },
			plugins: { state: 'named', running: ['review'], withheld: [] },
		}),
	} as never;
}

function actionEvent(fields: Record<string, string>) {
	const data = new FormData();
	for (const [k, v] of Object.entries(fields)) data.set(k, v);
	return { request: { formData: async () => data } } as never;
}

beforeEach(() => {
	vi.clearAllMocks();
	engine.get.mockImplementation(async (url: string) => {
		if (url.startsWith('/api/admin/review/definitions?')) {
			return {
				data: [{ id: 'd1', name: 'Editorial', slug: 'editorial', content_schema: 'article' }],
				total_count: 1,
				licensed: false,
				limits: { workflows: { limit: 1, current: 1 } },
			};
		}
		if (url.startsWith('/api/admin/review/definitions/')) {
			return {
				definition: { id: 'd1', name: 'Editorial' },
				stages: [{ id: 's1', name: 'Legal', position: 1, quorum: 2, escalate_to_role: 'lead', condition: { field: 'category', op: 'in', values: ['legal', 4] } }],
			};
		}
		return { data: [], total_count: 0 };
	});
});

describe('the reviews load', () => {
	it('carries what the definitions read says the install allows', async () => {
		const out = (await load(loadEvent())) as ReviewsPage;
		expect(out.limits).toEqual({ licensed: false, workflows: { limit: 1, current: 1 } });
	});

	it('reads each stage paid settings', async () => {
		const out = (await load(loadEvent())) as ReviewsPage;
		expect(out.definitions[0].stages[0]).toMatchObject({
			quorum: 2,
			escalate_to_role: 'lead',
			condition: { field: 'category', op: 'in', values: ['legal', '4'] },
		});
	});
});

describe('the assignment names', () => {
	const ENTRY = 'e1e1e1e1-0000-0000-0000-000000000000';
	const OTHER = 'e2e2e2e2-0000-0000-0000-000000000000';
	const MIRA = '22222222-2222-2222-2222-222222222222';

	beforeEach(() => {
		const base = engine.get.getMockImplementation() as (url: string) => Promise<unknown>;
		engine.get.mockImplementation(async (url: string) => {
			if (url.startsWith('/api/admin/review/assignments?')) {
				return {
					data: [
						{ id: 'a1', entry_id: ENTRY, definition_id: 'd1', current_stage_id: 's1', assignee_id: MIRA, status: 'in_review' },
						{ id: 'a2', entry_id: OTHER, definition_id: 'd1', current_stage_id: 's1', assignee_id: 'u1', status: 'in_review' },
					],
					total_count: 2,
				};
			}
			if (url === `/api/admin/content/${ENTRY}`) return { id: ENTRY, title: 'Spring launch notes', body: {} };
			if (url === `/api/admin/content/${OTHER}`) throw new ApiError(404, 'not found', {});
			if (url.startsWith('/api/admin/users?')) return [{ id: MIRA, email: 'mira.costa@example.com' }];
			return base(url);
		});
	});

	it('reads each entry title and each account email', async () => {
		const out = (await load(loadEvent())) as ReviewsPage;
		expect(out.entries).toEqual({ [ENTRY]: 'Spring launch notes' });
		expect(out.people[MIRA]).toBe('mira.costa@example.com');
	});

	it('names the signed-in reviewer without reading the directory', async () => {
		const out = (await load({
			url: new URL('http://localhost/admin/reviews'),
			parent: async () => ({
				user: { id: 'u1', email: 'reviewer@example.com', roles: ['editor'] },
				plugins: { state: 'named', running: ['review'], withheld: [] },
			}),
		} as never)) as ReviewsPage;
		expect(out.people).toEqual({ u1: 'reviewer@example.com' });
		expect(engine.get.mock.calls.some(([url]) => String(url).startsWith('/api/admin/users'))).toBe(false);
	});
});

describe('creating a definition', () => {
	const fields = {
		name: 'Legal',
		content_schema: 'article',
		stages: JSON.stringify([{ name: 'Legal', sla_duration_seconds: 3600, quorum: 2 }]),
	};

	it('sends the stage quorum', async () => {
		engine.post.mockResolvedValue({ id: 'd2' });
		await actions.create(actionEvent(fields));
		expect(engine.post.mock.calls[0][1]).toMatchObject({ stages: [{ name: 'Legal', quorum: 2 }] });
	});

	it('returns the workflow ceiling refusal with its numbers', async () => {
		engine.post.mockRejectedValue(
			new ApiError(402, 'cap_exceeded', { error: 'cap_exceeded', cap: 'review.workflows', limit: 1, current: 1 }),
		);
		const out = (await actions.create(actionEvent(fields))) as Failure;
		expect(out.status).toBe(402);
		expect(out.data.refused).toMatchObject({ kind: 'cap', limit: 1, current: 1 });
	});

	it('returns a paid stage setting refusal', async () => {
		engine.post.mockRejectedValue(
			new ApiError(402, 'payment_required', { error: 'payment_required', plugin: 'review', feature: 'feature:example_feature' }),
		);
		const out = (await actions.create(actionEvent(fields))) as Failure;
		expect(out.data.refused).toMatchObject({ kind: 'feature', feature: 'example-feature' });
	});
});
