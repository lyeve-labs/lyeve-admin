import { describe, it, expect, vi } from 'vitest';
import type { HttpClient } from '@lyeve-labs/client';
import { applyMigrations, pendingMigrations } from './migrate';

/** A client whose two verbs are spies, answering with whatever the case gives them. */
function client(answer: unknown): HttpClient {
	return {
		get: vi.fn(async () => answer),
		post: vi.fn(async () => answer),
	} as unknown as HttpClient;
}

describe('pendingMigrations', () => {
	it('reads the count off the engine answer', async () => {
		const c = client({ pending: 4 });

		expect(await pendingMigrations(c)).toBe(4);
		expect(c.get).toHaveBeenCalledWith('/api/admin/migrate');
	});

	it('carries zero through as zero', async () => {
		expect(await pendingMigrations(client({ pending: 0 }))).toBe(0);
	});

	/*
	 * Absent is not zero. Zero paints the header chip green and states that the
	 * database matches the schemas, which is a claim about an answer nobody got.
	 */
	it('reports an unreadable count as unknown', async () => {
		expect(await pendingMigrations(client({}))).toBeNull();
		expect(await pendingMigrations(client(null))).toBeNull();
		expect(await pendingMigrations(client({ pending: '2' }))).toBeNull();
		expect(await pendingMigrations(client({ pending: Number.NaN }))).toBeNull();
	});

	it('lets a refusal reach the caller, who decides what it means', async () => {
		const c = {
			get: vi.fn(async () => {
				throw new Error('503 database unavailable');
			}),
		} as unknown as HttpClient;

		await expect(pendingMigrations(c)).rejects.toThrow('503 database unavailable');
	});
});

describe('applyMigrations', () => {
	it('posts to the apply endpoint and answers with how many ran', async () => {
		const c = client({ applied: 2 });

		expect(await applyMigrations(c)).toBe(2);
		expect(c.post).toHaveBeenCalledWith('/api/admin/migrate/apply', undefined);
	});

	it('sends no body, because the endpoint takes none', async () => {
		const c = client({ applied: 0 });

		await applyMigrations(c);

		expect((c.post as ReturnType<typeof vi.fn>).mock.calls[0][1]).toBeUndefined();
	});

	it('throws the engine refusal so the action can relay its message', async () => {
		const c = {
			post: vi.fn(async () => {
				throw new Error('migration 059 failed');
			}),
		} as unknown as HttpClient;

		await expect(applyMigrations(c)).rejects.toThrow('migration 059');
	});
});
