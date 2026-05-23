import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@lyeve-labs/client';

const engine = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock('$lib/server/authz', () => ({
	authedClient: vi.fn(() => engine),
	requireRole: vi.fn(async () => ({ id: 'u1', roles: ['admin'] })),
}));

import { actions, load } from './+page.server';

function event(form: Record<string, string> = {}) {
	const data = new FormData();
	for (const [k, v] of Object.entries(form)) data.set(k, v);
	return {
		parent: async () => ({ plugins: { state: 'named', running: ['audit'], withheld: [] } }),
		request: { formData: async () => data },
	} as never;
}

beforeEach(() => vi.clearAllMocks());

describe('audit sinks', () => {
	it('lists the destinations the engine holds', async () => {
		engine.get.mockResolvedValue({ data: [{ id: 's1', name: 'SIEM' }] });
		const out = (await load(event())) as Record<string, unknown>;
		expect(engine.get).toHaveBeenCalledWith('/api/admin/audit-log/sinks');
		expect(out.sinks).toHaveLength(1);
	});

	it('returns a generated signing secret once, with the create', async () => {
		engine.post.mockResolvedValue({ id: 's1', name: 'SIEM', secret: 'whsec_once' });
		const out = await actions.create(event({ kind: 'https', name: 'SIEM', url: 'https://siem.example.com', enabled: 'true' }));
		expect(out).toEqual({ created: 'SIEM', secret: 'whsec_once' });
		expect(engine.post.mock.calls[0][1]).not.toHaveProperty('secret');
	});

	it('asks for the Splunk token before it calls the engine', async () => {
		const out = (await actions.create(event({ kind: 'splunk', name: 'S', url: 'https://s.example.com' }))) as {
			data: { fields: Record<string, string> };
		};
		expect(out.data.fields.secret).toBe('The HEC token is required');
		expect(engine.post).not.toHaveBeenCalled();
	});

	it('renders the license refusal with the capability it names', async () => {
		engine.post.mockRejectedValue(
			new ApiError(402, 'payment_required', { error: 'payment_required', plugin: 'example', feature: 'feature:example_capability' }),
		);
		const out = (await actions.create(event({ kind: 'https', name: 'S', url: 'https://s.example.com' }))) as {
			status: number;
			data: Record<string, unknown>;
		};
		expect(out.status).toBe(402);
		expect(out.data.refused).toMatchObject({ kind: 'feature', feature: 'example-capability' });
	});

	it('reports a test that did not land', async () => {
		engine.post.mockResolvedValue({ delivered: false, error: 'receiver answered 500' });
		const out = await actions.test(event({ id: 's1' }));
		expect(out).toEqual({ tested: 's1', delivered: false, testError: 'receiver answered 500' });
	});
});
