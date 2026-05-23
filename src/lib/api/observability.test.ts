import { describe, it, expect } from 'vitest';
import { DEFAULT_LATENCY_TOP, LATENCY_TOP_CHOICES, latencyTop } from './observability';

describe('latencyTop', () => {
	it('accepts every row count the control offers', () => {
		for (const n of LATENCY_TOP_CHOICES) {
			expect(latencyTop(String(n))).toBe(n);
		}
	});

	it('falls back to the default for anything the ranking does not offer', () => {
		expect(latencyTop('7')).toBe(DEFAULT_LATENCY_TOP);
		expect(latencyTop('1000000')).toBe(DEFAULT_LATENCY_TOP);
		expect(latencyTop('all')).toBe(DEFAULT_LATENCY_TOP);
		expect(latencyTop('')).toBe(DEFAULT_LATENCY_TOP);
		expect(latencyTop(null)).toBe(DEFAULT_LATENCY_TOP);
		expect(latencyTop(undefined)).toBe(DEFAULT_LATENCY_TOP);
	});
});
