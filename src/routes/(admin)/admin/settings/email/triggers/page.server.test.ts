import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@lyeve-labs/client';

const api = vi.hoisted(() => ({
	listEmailTriggers: vi.fn(),
	listEmailTemplates: vi.fn(),
	getSchemas: vi.fn(),
}));

vi.mock('$lib/server/authz', () => ({ authedClient: () => ({}), requireUser: async () => ({ id: 'u1', roles: ['admin'] }) }));
vi.mock('$lib/api/email-triggers', async (orig) => ({
	...(await orig<typeof import('$lib/api/email-triggers')>()),
	listEmailTriggers: api.listEmailTriggers,
	listEmailTemplates: api.listEmailTemplates,
}));
vi.mock('@lyeve-labs/client-rest', () => ({ getSchemas: api.getSchemas }));

const { load } = await import('./+page.server');

type Loaded = Exclude<Awaited<ReturnType<typeof load>>, void>;

beforeEach(() => {
	vi.clearAllMocks();
	api.listEmailTriggers.mockResolvedValue({ triggers: [], events: ['after_create'] });
	api.listEmailTemplates.mockResolvedValue([{ id: 't1', key: 'welcome', subject: 'Hi', status: 'active' }]);
	api.getSchemas.mockResolvedValue([{ name: 'posts' }, { name: 'orders' }]);
});

describe('email triggers load', () => {
	it('reads the triggers, the templates and the schemas', async () => {
		const out = (await load({} as never)) as Loaded;
		expect(out.triggers.ok).toBe(true);
		expect(out.templates).toMatchObject({ ok: true, value: [{ key: 'welcome' }] });
		expect(out.schemas).toEqual({ ok: true, value: ['orders', 'posts'] });
	});

	it('keeps a failed template read apart from a tenant with no templates', async () => {
		api.listEmailTemplates.mockRejectedValue(new ApiError(503, 'down'));
		const out = (await load({} as never)) as Loaded;
		expect(out.templates).toEqual({ ok: false, gate: { state: 'unavailable' } });
		expect(out.triggers.ok).toBe(true);
	});

	it('keeps a refused trigger read as forbidden', async () => {
		api.listEmailTriggers.mockRejectedValue(new ApiError(403, 'forbidden'));
		const out = (await load({} as never)) as Loaded;
		expect(out.triggers).toEqual({ ok: false, gate: { state: 'forbidden' } });
	});
});
