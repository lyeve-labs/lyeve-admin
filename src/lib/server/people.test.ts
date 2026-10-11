import { describe, expect, it, vi } from 'vitest';
import { ApiError, type HttpClient } from '@lyeve-labs/client';
import { listPeople } from './people';

function client(get: (url: string) => Promise<unknown>): HttpClient {
	return { get: vi.fn(get) } as unknown as HttpClient;
}

describe('listPeople', () => {
	it('reads the bare array the engine answers', async () => {
		const out = await listPeople(client(async () => [{ id: 'u1', email: 'a@example.com', roles: ['editor'] }]));
		expect(out).toEqual([{ id: 'u1', email: 'a@example.com' }]);
	});

	it('reads an enveloped answer and drops rows with no email', async () => {
		const out = await listPeople(client(async () => ({ data: [{ id: 'u1', email: 'a@example.com' }, { id: 'u2' }] })));
		expect(out).toEqual([{ id: 'u1', email: 'a@example.com' }]);
	});

	it('answers none to a caller the engine refuses', async () => {
		const out = await listPeople(
			client(async () => {
				throw new ApiError(403, 'forbidden', {});
			}),
		);
		expect(out).toEqual([]);
	});
});
