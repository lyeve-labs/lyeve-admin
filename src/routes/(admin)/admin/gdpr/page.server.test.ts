import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@lyeve-labs/client';

const rest = vi.hoisted(() => ({ exportSubject: vi.fn(), eraseSubject: vi.fn() }));
vi.mock('@lyeve-labs/client-rest', () => rest);

const authz = vi.hoisted(() => ({
	authedClient: vi.fn(() => ({})),
	requireRole: vi.fn(async () => ({ id: 'u1', roles: ['super_admin'] })),
}));
vi.mock('$lib/server/authz', () => authz);

import { actions } from './+page.server';

function formEvent(fields: Record<string, string>) {
	const body = new FormData();
	for (const [k, v] of Object.entries(fields)) body.set(k, v);
	return { request: new Request('http://admin/admin/gdpr', { method: 'POST', body }), cookies: {}, fetch: vi.fn() } as never;
}

type Failure = { status: number; data: { error: string } };

beforeEach(() => vi.clearAllMocks());

// A failed privacy request names the subject's data. The engine's own text
// for a failure can carry driver detail, so only a refusal written for the
// operator reaches the page.
describe('privacy request failures', () => {
	it('keeps the text of an engine failure off the page on export', async () => {
		rest.exportSubject.mockRejectedValue(new ApiError(500, 'pq: relation "sys_users" does not exist'));
		const out = (await actions.export(formEvent({ subject: 'jane@example.com' }))) as Failure;
		expect(out.data.error).not.toContain('sys_users');
		expect(out.data.error).toBe('The export could not be made. Nothing was read for this subject.');
	});

	it('keeps the text of an engine failure off the page on erasure', async () => {
		rest.eraseSubject.mockRejectedValue(new ApiError(503, 'dial tcp 10.0.0.4:5432: connection refused'));
		const out = (await actions.erase(formEvent({ subject: 'jane@example.com', confirm: 'jane@example.com' }))) as Failure;
		expect(out.data.error).not.toContain('10.0.0.4');
		expect(out.data.error).toBe('The erasure was not attempted, so nothing was erased. Try again in a moment.');
	});

	it('relays a refusal written for the operator', async () => {
		rest.eraseSubject.mockRejectedValue(new ApiError(400, 'identifier must be an email address or a user id'));
		const out = (await actions.erase(formEvent({ subject: 'x', confirm: 'x' }))) as Failure;
		expect(out.data.error).toBe('identifier must be an email address or a user id');
	});
});

// The engine serves both privacy requests to a super admin only, and an
// erasure cannot be undone, so the action asks before it sends anything.
describe('privacy requests', () => {
	it('exports the named subject and hands back what the engine found', async () => {
		rest.exportSubject.mockResolvedValue({ users: [{ id: 'u9' }] });
		const out = await actions.export(formEvent({ subject: ' jane@example.com ' }));
		expect(rest.exportSubject).toHaveBeenCalledWith('jane@example.com', expect.anything());
		expect(out).toEqual({ action: 'export', ok: true, subject: 'jane@example.com', result: { users: [{ id: 'u9' }] } });
	});

	it('erases the subject once the confirmation matches', async () => {
		rest.eraseSubject.mockResolvedValue({ erased: 3 });
		const out = await actions.erase(formEvent({ subject: 'jane@example.com', confirm: 'jane@example.com' }));
		expect(rest.eraseSubject).toHaveBeenCalledWith('jane@example.com', expect.anything());
		expect(out).toEqual({ action: 'erase', ok: true, subject: 'jane@example.com', result: { erased: 3 } });
	});

	it('erases nothing when the confirmation names someone else', async () => {
		const out = (await actions.erase(formEvent({ subject: 'jane@example.com', confirm: 'john@example.com' }))) as Failure;
		expect(out.status).toBe(400);
		expect(out.data.error).toBe('Confirmation does not match the subject identifier');
		expect(rest.eraseSubject).not.toHaveBeenCalled();
	});

	it.each(['export', 'erase'] as const)('asks for a subject before %s', async (name) => {
		const out = (await actions[name](formEvent({ subject: ' ', confirm: ' ' }))) as Failure;
		expect(out.data.error).toBe('Subject identifier is required');
		expect(rest.exportSubject).not.toHaveBeenCalled();
		expect(rest.eraseSubject).not.toHaveBeenCalled();
	});

	it.each(['export', 'erase'] as const)('stops %s for a reader who is not a super admin', async (name) => {
		authz.requireRole.mockRejectedValueOnce(Object.assign(new Error('403'), { status: 403 }));
		await expect(actions[name](formEvent({ subject: 'jane@example.com', confirm: 'jane@example.com' }))).rejects.toMatchObject({ status: 403 });
		expect(authz.requireRole).toHaveBeenCalledWith(expect.anything(), ['super_admin']);
		expect(rest.exportSubject).not.toHaveBeenCalled();
		expect(rest.eraseSubject).not.toHaveBeenCalled();
	});
});
