import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
	getDashboardLayout: vi.fn(),
	saveDashboardLayout: vi.fn(),
	resetDashboardLayout: vi.fn(),
}));
const resolve = vi.hoisted(() => vi.fn(async (_c: unknown, widgets: { id: string }[]) => widgets.map((w) => ({ ...w, heading: w.id }))));

// The preview asks the engine which plugins run, as an action has no layout.
vi.mock('$lib/server/authz', () => ({
	authedClient: vi.fn(() => ({ get: vi.fn(async () => ({ plugins: ['content'], withheld: [] })) })),
	requireRole: vi.fn(async () => ({ roles: ['admin'] })),
}));
vi.mock('$lib/api/search-settings', () => ({ listSchemaNames: vi.fn(async () => ['posts']) }));
vi.mock('$lib/server/dashboard-widgets', () => ({ resolveWidgets: resolve }));
vi.mock('$lib/api/custom-dashboard', async (orig) => ({
	...(await orig<typeof import('$lib/api/custom-dashboard')>()),
	...api,
}));

import { actions, load } from './+page.server';

function event(form: Record<string, string> = {}, { entitled = true, roles = ['admin'] } = {}) {
	const fd = new FormData();
	for (const [k, v] of Object.entries(form)) fd.append(k, v);
	return {
		request: new Request('http://localhost', { method: 'POST', body: fd }),
		params: {},
		parent: async () => ({
			user: { roles },
			customization: { entitled, settings: {}, pages: [] },
		}),
	} as never;
}

const layout = JSON.stringify([
	{ id: 'a', type: 'status_breakdown', width: 'third', schema: 'posts', body: 'stale' },
	{ id: 'b', type: 'text', body: 'For editors', roles: ['editor'] },
]);

beforeEach(() => {
	vi.clearAllMocks();
	api.getDashboardLayout.mockResolvedValue({ entitled: true, custom: false, widgets: [], updated_at: null });
	api.saveDashboardLayout.mockResolvedValue({});
	api.resetDashboardLayout.mockResolvedValue(undefined);
});

describe('dashboard editor', () => {
	it('sends a reader without the capability back to customization', async () => {
		await expect(load(event({}, { entitled: false }))).rejects.toMatchObject({ status: 303, location: '/admin/settings/customization' });
	});

	it('refuses a reader who is not an admin', async () => {
		await expect(load(event({}, { roles: ['editor'] }))).rejects.toMatchObject({ status: 403 });
	});

	it('reads the layout and the schemas', async () => {
		const data = (await load(event())) as { schemas: string[]; layout: { custom: boolean } };
		expect(data.schemas).toEqual(['posts']);
		expect(data.layout.custom).toBe(false);
	});

	it('saves the layout the form carries', async () => {
		expect(await actions.save(event({ widgets: layout }))).toEqual({ saved: true });
		expect(api.saveDashboardLayout.mock.calls[0][1]).toHaveLength(2);
	});

	it('refuses an empty layout and points at the reset', async () => {
		const res = (await actions.save(event({ widgets: '[]' }))) as { status: number; data: { error: string } };
		expect(res.status).toBe(400);
		expect(res.data.error).toMatch(/reset/);
		expect(api.saveDashboardLayout).not.toHaveBeenCalled();
	});

	it('refuses a form that carries no layout', async () => {
		expect(((await actions.save(event({ widgets: '{oops' }))) as { status: number }).status).toBe(400);
	});

	it("shows the engine's refusal", async () => {
		api.saveDashboardLayout.mockRejectedValue(Object.assign(new Error('widget 2: "html" is not a widget type'), { status: 422 }));
		const res = (await actions.save(event({ widgets: layout }))) as { status: number };
		expect(res.status).toBe(400);
	});

	it('previews the unsaved layout as the chosen role, sending only what each type reads', async () => {
		const res = (await actions.preview(event({ widgets: layout, as: 'viewer' }))) as { previewAs: string };
		expect(res.previewAs).toBe('viewer');
		const [, widgets, roles, plugins] = resolve.mock.calls[0] as unknown as [unknown, { body?: string }[], string[], unknown];
		expect(roles).toEqual(['viewer']);
		expect(plugins).toEqual({ state: 'named', running: ['content'], withheld: [] });
		expect(widgets[0].body).toBeUndefined();
		expect(api.saveDashboardLayout).not.toHaveBeenCalled();
	});

	it('previews as an admin for a role it does not know', async () => {
		const res = (await actions.preview(event({ widgets: layout, as: 'owner' }))) as { previewAs: string };
		expect(res.previewAs).toBe('admin');
	});

	it('resets to the stock dashboard', async () => {
		expect(await actions.reset(event())).toEqual({ reset: true });
		expect(api.resetDashboardLayout).toHaveBeenCalledOnce();
	});
});
