import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiError } from '@lyeve-labs/client';

const api = vi.hoisted(() => ({
	listJobs: vi.fn(),
	getJob: vi.fn(),
	listRows: vi.fn(),
	listTemplates: vi.fn(),
	rollbackJob: vi.fn(),
	createTemplate: vi.fn(),
	updateTemplate: vi.fn(),
	deleteTemplate: vi.fn(),
}));

vi.mock('$lib/api/bulk-import', async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	...api,
}));

vi.mock('@lyeve-labs/client-rest', () => ({ getSchemas: vi.fn(async () => []) }));

vi.mock('$lib/server/authz', () => ({
	authedClient: vi.fn(() => ({})),
	requireRole: vi.fn(async () => ({ id: 'u1', roles: ['admin'] })),
}));

import { load, actions } from './+page.server';
import { requireRole } from '$lib/server/authz';

type Loaded = Exclude<Awaited<ReturnType<typeof load>>, void>;

function loadEvent(query = '') {
	return {
		url: new URL(`http://admin/admin/imports${query}`),
		fetch: vi.fn(),
		cookies: {},
		depends: vi.fn(),
		parent: async () => ({ user: { roles: ['admin'] } }),
	} as never;
}

function formEvent(fields: Record<string, string>) {
	const body = new FormData();
	for (const [k, v] of Object.entries(fields)) body.set(k, v);
	return {
		request: new Request('http://admin/admin/imports', { method: 'POST', body }),
		cookies: {},
		fetch: vi.fn(),
	} as never;
}

const template = {
	id: 't1',
	name: 'Orders',
	content_type: 'orders',
	mode: 'upsert',
	upsert_key: 'entry.slug',
	field_mappings: [{ source_field: 'Placed', target_field: 'placed_at', transform: 'date', transform_options: { layout: '02/01/2006' } }],
	created_at: '2026-10-01T00:00:00Z',
	updated_at: '2026-10-01T00:00:00Z',
};

const mapping = JSON.stringify([{ source_field: 'Name', target_field: 'title', data_type: 'string' }]);

beforeEach(() => {
	vi.clearAllMocks();
	api.listJobs.mockResolvedValue({ data: [], total_count: 0 });
	api.listTemplates.mockResolvedValue({ licensed: false, templates: [template] });
});

describe('imports load', () => {
	it('carries the templates and whether this install may save one', async () => {
		const result = (await load(loadEvent())) as Loaded;
		expect(result.templates).toEqual([template]);
		expect(result.templatesRead).toBe(true);
		expect(result.licensed).toBe(false);
	});

	it('says the templates were not read rather than that there are none', async () => {
		api.listTemplates.mockRejectedValue(new Error('down'));
		const result = (await load(loadEvent())) as Loaded;
		expect(result.templatesRead).toBe(false);
		expect(result.licensed).toBeNull();
	});
});

describe('imports load keeps failed reads apart from empty ones', () => {
	it('keeps an unread content type list as a failure', async () => {
		const rest = await import('@lyeve-labs/client-rest');
		vi.mocked(rest.getSchemas).mockRejectedValueOnce(new Error('down'));
		const result = (await load(loadEvent())) as Loaded;
		expect(result.schemas.ok).toBe(false);
	});

	it('hands over the content types a read answered with', async () => {
		const result = (await load(loadEvent())) as Loaded;
		expect(result.schemas).toEqual({ ok: true, value: [] });
	});

	it('opens the rows panel with the failure when the job cannot be read', async () => {
		api.getJob.mockRejectedValue(new ApiError(404, 'not found'));
		api.listRows.mockResolvedValue({ rows: [], total: 0 });
		const result = (await load(loadEvent('?job=j9'))) as Loaded;
		expect(result.detail).toEqual({ ok: false, gate: { state: 'absent' } });
	});

	it('reads no rows panel when none was asked for', async () => {
		const result = (await load(loadEvent())) as Loaded;
		expect(result.detail).toBeNull();
	});

	it('sends a page past the end back to the last page', async () => {
		api.listJobs.mockResolvedValue({ data: [], total_count: 30 });
		await expect(load(loadEvent('?offset=100'))).rejects.toMatchObject({
			status: 307,
			location: '/admin/imports?offset=25',
		});
	});
});

describe('rollback', () => {
	// The engine admits any admin to the rollback route, so the console asks
	// for no more than that.
	it('takes a rollback from an admin', async () => {
		api.rollbackJob.mockResolvedValue(undefined);
		expect(await actions.rollback(formEvent({ id: 'j1' }))).toEqual({ rolledBack: 'j1' });
		expect(requireRole).toHaveBeenCalledWith(expect.anything(), ['admin', 'super_admin']);
	});
});

describe('template actions', () => {
	it('creates a template from the drawer', async () => {
		api.createTemplate.mockResolvedValue(template);
		const out = await actions.createTemplate(
			formEvent({ name: 'People', content_type: 'people', mode: 'create', mappings: mapping }),
		);
		expect(api.createTemplate).toHaveBeenCalledWith(expect.anything(), {
			name: 'People',
			content_type: 'people',
			mode: 'create',
			field_mappings: JSON.parse(mapping),
		});
		expect(out).toEqual({ savedTemplate: 'People' });
	});

	it('refuses an upsert template with no key before the round trip', async () => {
		const out = (await actions.createTemplate(
			formEvent({ name: 'People', content_type: 'people', mode: 'upsert', mappings: mapping }),
		)) as { status: number };
		expect(out.status).toBe(400);
		expect(api.createTemplate).not.toHaveBeenCalled();
	});

	it('refuses a template with no mapping', async () => {
		const out = (await actions.createTemplate(
			formEvent({ name: 'People', content_type: 'people', mode: 'create', mappings: '[]' }),
		)) as { status: number };
		expect(out.status).toBe(400);
	});

	it('returns the license refusal so the page renders it', async () => {
		api.updateTemplate.mockRejectedValue(
			new ApiError(402, 'payment_required', { error: 'payment_required', plugin: 'example', feature: 'feature:example_feature' }),
		);
		const out = (await actions.updateTemplate(
			formEvent({ id: 't1', name: 'People', content_type: 'people', mode: 'create', mappings: mapping }),
		)) as { status: number; data: { refused: { kind: string } } };
		expect(out.status).toBe(402);
		expect(out.data.refused.kind).toBe('feature');
		expect((out.data as unknown as { action: string }).action).toBe('saveTemplate');
		expect(api.updateTemplate).toHaveBeenCalledWith(expect.anything(), 't1', expect.anything());
	});

	it('deletes a template', async () => {
		api.deleteTemplate.mockResolvedValue(undefined);
		expect(await actions.deleteTemplate(formEvent({ id: 't1' }))).toEqual({ removedTemplate: 't1' });
	});
});
