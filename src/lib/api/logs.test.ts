import { describe, expect, it, vi } from 'vitest';
import type { HttpClient } from '@lyeve-labs/client';
import { couldBeId, searchLogEntries } from './logs';

const REQUEST_ID = '63d30d6e67aedcfb1aca05eeef3c8322';

function page(total: number, message = 'm') {
	return { results: Array.from({ length: Math.min(total, 1) }, () => ({ timestamp: 't', level: 'INFO', message })), total, limit: 100, offset: 0 };
}

/**
 * A fake engine that answers each filter from a table. A request names one
 * filter at most, which is what the page sends.
 */
function engine(answers: { request_id?: number; trace_id?: number; query?: number; none?: number }) {
	const calls: URLSearchParams[] = [];
	const get = vi.fn(async (url: string) => {
		const qs = new URL(url, 'http://x').searchParams;
		calls.push(qs);
		for (const key of ['request_id', 'trace_id', 'query'] as const) {
			if (qs.has(key)) return page(answers[key] ?? 0, key);
		}
		return page(answers.none ?? 0, 'all');
	});
	return { client: { get } as unknown as HttpClient, calls };
}

const query = (q: string) => ({ q, level: '', limit: 100, offset: 0 });

describe('log search', () => {
	it('finds a request id that the message search cannot', async () => {
		const { client } = engine({ request_id: 4, query: 0 });

		const res = await searchLogEntries(client, query(REQUEST_ID));

		expect(res?.total).toBe(4);
		expect(res?.results[0]?.message).toBe('request_id');
	});

	it('finds a trace id', async () => {
		const { client } = engine({ trace_id: 7 });

		const res = await searchLogEntries(client, query(REQUEST_ID));

		expect(res?.total).toBe(7);
		expect(res?.results[0]?.message).toBe('trace_id');
	});

	it('answers a word that names no id with the message search', async () => {
		const { client } = engine({ query: 12 });

		const res = await searchLogEntries(client, query('timeout'));

		expect(res?.total).toBe(12);
		expect(res?.results[0]?.message).toBe('query');
	});

	it('looks up a phrase as message text only', async () => {
		const { client, calls } = engine({ query: 2 });

		await searchLogEntries(client, query('gateway timed out'));

		expect(calls).toHaveLength(1);
		expect(calls[0]?.get('query')).toBe('gateway timed out');
	});

	it('sends no term for an empty search and keeps the level and position', async () => {
		const { client, calls } = engine({ none: 3 });

		await searchLogEntries(client, { q: '  ', level: 'WARN', limit: 50, offset: 150 });

		expect(calls).toHaveLength(1);
		const qs = calls[0];
		expect(qs?.has('query')).toBe(false);
		expect(qs?.get('level')).toBe('WARN');
		expect(qs?.get('limit')).toBe('50');
		expect(qs?.get('offset')).toBe('150');
	});

	it('keeps the level on every lookup', async () => {
		const { client, calls } = engine({});

		await searchLogEntries(client, { ...query(REQUEST_ID), level: 'ERROR' });

		expect(calls).toHaveLength(3);
		expect(calls.every((qs) => qs.get('level') === 'ERROR')).toBe(true);
	});

	it('reads a failed lookup as no match', async () => {
		const get = vi.fn(async (url: string) => {
			if (url.includes('request_id=')) throw new Error('refused');
			if (url.includes('trace_id=')) return page(5, 'trace_id');
			return page(0);
		});

		const res = await searchLogEntries({ get } as unknown as HttpClient, query(REQUEST_ID));

		expect(res?.total).toBe(5);
	});

	// A failed search drawn as an empty one told the reader no entry matched.
	it('throws when the message search fails', async () => {
		const get = vi.fn(async (url: string) => {
			if (url.includes('query=')) throw new Error('refused');
			return page(0);
		});

		await expect(searchLogEntries({ get } as unknown as HttpClient, query(REQUEST_ID))).rejects.toThrow('refused');
	});

	it('throws when a search with no term fails', async () => {
		const get = vi.fn(async () => {
			throw new Error('refused');
		});

		await expect(searchLogEntries({ get } as unknown as HttpClient, query(''))).rejects.toThrow('refused');
	});
});

describe('what could be an id', () => {
	it.each([
		[REQUEST_ID, true],
		['550e8400-e29b-41d4-a716-446655440000', true],
		['two words', false],
		['', false],
		['x'.repeat(129), false],
	])('%s', (term, want) => {
		expect(couldBeId(term)).toBe(want);
	});
});
