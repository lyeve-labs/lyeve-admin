import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@lyeve-labs/client';

const engine = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
const authz = vi.hoisted(() => ({ roles: ['super_admin'] as string[] }));
vi.mock('$lib/server/authz', async (importOriginal) => ({
	...((await importOriginal()) as object),
	authedClient: vi.fn(() => engine),
	requireRole: vi.fn(async (_event: unknown, allowed: string[]) => {
		if (!allowed.some((r) => authz.roles.includes(r))) throw new Error('403');
		return { id: 'u1', roles: authz.roles };
	}),
}));

import { actions } from './+page.server';

function event(fields: Record<string, string>) {
	const data = new FormData();
	for (const [k, v] of Object.entries(fields)) data.set(k, v);
	return { request: { formData: async () => data } } as never;
}

type Failure = { status: number; data: Record<string, unknown> };

const job = { name: 'digest', schedule: '0 9 * * *', endpoint: 'https://x.example.com', enabled: 'on' };

beforeEach(() => {
	vi.clearAllMocks();
	authz.roles = ['super_admin'];
});

describe('the jobs role check', () => {
	// The cron plugin serves the job writes to a super admin only.
	it.each(['create', 'update', 'delete'] as const)('refuses %s to an admin', async (name) => {
		authz.roles = ['admin'];
		await expect(actions[name](event({ ...job, id: 'j1' }))).rejects.toThrow('403');
		expect(engine.post).not.toHaveBeenCalled();
		expect(engine.put).not.toHaveBeenCalled();
		expect(engine.delete).not.toHaveBeenCalled();
	});
});

describe('which form a failure belongs to', () => {
	it('tags a failed update for the drawer', async () => {
		engine.put.mockRejectedValue(new ApiError(422, 'schedule fires more than once a minute', {}));
		const out = (await actions.update(event({ ...job, id: 'j1' }))) as Failure;
		expect(out.data).toMatchObject({ action: 'update', error: 'schedule fires more than once a minute' });
	});

	it('tags a failed create for the drawer', async () => {
		const out = (await actions.create(event({ ...job, payload: '{' }))) as Failure;
		expect(out.data.action).toBe('create');
	});
});

describe('deleting a job', () => {
	it('deletes the job it names and returns to the list', async () => {
		engine.delete.mockResolvedValue(undefined);
		await expect(actions.delete(event({ id: 'j1' }))).rejects.toMatchObject({ status: 303 });
		expect(engine.delete).toHaveBeenCalledWith('/api/admin/jobs/j1');
	});

	it("relays the plugin's refusal, tagged for the page", async () => {
		engine.delete.mockRejectedValue(new ApiError(404, 'job not found', {}));
		const out = (await actions.delete(event({ id: 'j1' }))) as Failure;
		expect(out.data).toEqual({ error: 'job not found', action: 'delete' });
	});

	it('says an outage failed the delete', async () => {
		engine.delete.mockRejectedValue(new ApiError(503, 'down', {}));
		const out = (await actions.delete(event({ id: 'j1' }))) as Failure;
		expect(out.data).toEqual({ error: 'Failed to delete job.', action: 'delete' });
	});
});
