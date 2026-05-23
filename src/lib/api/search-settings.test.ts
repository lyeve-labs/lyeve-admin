import { describe, it, expect, vi } from 'vitest';
import type { HttpClient } from '@lyeve-labs/client';
import { listSchemaNames, parseTerms, parseWeight } from './search-settings';

describe('parseWeight', () => {
	it('accepts a number from 0 to 10 and nothing else', () => {
		expect(parseWeight('0.4')).toBe(0.4);
		expect(parseWeight('10')).toBe(10);
		expect(parseWeight('')).toBeNull();
		expect(parseWeight('-1')).toBeNull();
		expect(parseWeight('11')).toBeNull();
		expect(parseWeight('heavy')).toBeNull();
	});
});

describe('parseTerms', () => {
	it('splits on commas, trims and keeps each term once', () => {
		expect(parseTerms(' kettle, jug ,,kettle ')).toEqual(['kettle', 'jug']);
	});
});

describe('listSchemaNames', () => {
	it('reads a bare array or an envelope, sorted', async () => {
		const bare = { get: vi.fn().mockResolvedValue([{ name: 'posts' }, { name: 'blog' }]) } as unknown as HttpClient;
		expect(await listSchemaNames(bare)).toEqual(['blog', 'posts']);
		const env = { get: vi.fn().mockResolvedValue({ data: [{ name: 'faq' }] }) } as unknown as HttpClient;
		expect(await listSchemaNames(env)).toEqual(['faq']);
	});
});
