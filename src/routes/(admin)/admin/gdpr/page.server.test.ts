import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@lyeve-labs/client';

const rest = vi.hoisted(() => ({ exportSubject: vi.fn(), eraseSubject: vi.fn() }));
vi.mock('@lyeve-labs/client-rest', () => rest);

vi.mock('$lib/server/authz', () => ({
	authedClient: vi.fn(() => ({})),
	requireRole: vi.fn(async () => ({ id: 'u1', roles: ['super_admin'] })),
}));

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
