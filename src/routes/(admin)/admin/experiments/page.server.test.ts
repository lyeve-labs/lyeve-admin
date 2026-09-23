import { beforeEach, describe, expect, it, vi } from 'vitest';

const engine = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock('$lib/server/authz', () => ({
	authedClient: vi.fn(() => engine),
	requireRole: vi.fn(async () => ({ id: 'u1', roles: ['admin'] })),
}));

import { actions } from './+page.server';

function event(form: Record<string, string>) {
	const data = new FormData();
	for (const [k, v] of Object.entries(form)) data.set(k, v);
	const request = { formData: async () => data, clone: () => request };
	return { request } as never;
}

beforeEach(() => {
	vi.clearAllMocks();
	engine.post.mockResolvedValue({});
	engine.put.mockResolvedValue({});
});

// The engine counts a result as significant when its p-value is below one
// minus the threshold, so the threshold is a confidence level. A form that
// sends 0.05 asks for p < 0.95 and declares a winner on noise.
describe('experiment significance threshold', () => {
	it('sends a confidence of 0.95 when the field is left empty', async () => {
		await actions.create(event({ name: 'Checkout button' }));
		expect(engine.post).toHaveBeenCalledOnce();
		expect(engine.post.mock.calls[0][1]).toMatchObject({ significance_threshold: 0.95 });
	});

	it('saves an experiment stored at 0.95 unchanged', async () => {
		const out = await actions.update(event({ id: 'e1', name: 'Checkout button', significance_threshold: '0.95', min_sample_size: '100' }));
		expect(out).toEqual({ saved: 'Checkout button' });
		expect(engine.put.mock.calls[0][0]).toBe('/api/admin/ab/experiments/e1');
		expect(engine.put.mock.calls[0][1]).toMatchObject({ significance_threshold: 0.95 });
	});

	it.each(['0.5', '0.9', '0.99', '0.999'])('accepts a confidence of %s', async (value) => {
		await actions.create(event({ name: 'x', significance_threshold: value }));
		expect(engine.post.mock.calls[0][1]).toMatchObject({ significance_threshold: Number(value) });
	});

	it.each(['0.05', '0.2', '0.49', '1', '0', '-0.95', 'high'])('refuses %s before calling the engine', async (value) => {
		const out = (await actions.create(event({ name: 'x', significance_threshold: value }))) as { status: number; data: { error: string } };
		expect(out.status).toBe(400);
		expect(out.data.error).toContain('confidence');
		expect(engine.post).not.toHaveBeenCalled();
	});
});
