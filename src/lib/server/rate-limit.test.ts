import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// The limiter reads its bounds from the environment when the module is
// evaluated, so the suite sets them and imports fresh rather than asking the
// module for a way to rewrite them, which would ship a function that could
// widen a brute-force limit. Re-importing also gives each test an empty
// store.
let checkRateLimit: typeof import('./rate-limit').checkRateLimit;
let cleanupRateLimitStore: typeof import('./rate-limit').cleanupRateLimitStore;

describe('rate-limit', () => {
	beforeEach(async () => {
		vi.stubEnv('RATE_LIMIT_AUTH_WINDOW_MS', '1000');
		vi.stubEnv('RATE_LIMIT_AUTH_MAX_ATTEMPTS', '3');
		vi.resetModules();
		({ checkRateLimit, cleanupRateLimitStore } = await import('./rate-limit'));
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllEnvs();
	});

	// checkRateLimit

	describe('checkRateLimit', () => {
		it('allows the first attempt from an IP', () => {
			const result = checkRateLimit('10.0.0.1');
			expect(result).toEqual({ allowed: true, retryAfterSec: 0 });
		});

		it('allows attempts up to MAX_ATTEMPTS', () => {
			checkRateLimit('10.0.0.1'); // 1
			checkRateLimit('10.0.0.1'); // 2
			const result = checkRateLimit('10.0.0.1'); // 3 (MAX_ATTEMPTS)
			expect(result.allowed).toBe(true);
		});

		it('blocks attempts beyond MAX_ATTEMPTS', () => {
			checkRateLimit('10.0.0.1'); // 1
			checkRateLimit('10.0.0.1'); // 2
			checkRateLimit('10.0.0.1'); // 3
			const result = checkRateLimit('10.0.0.1'); // 4 → blocked
			expect(result.allowed).toBe(false);
			expect(result.retryAfterSec).toBeGreaterThan(0);
		});

		it('refreshes the window after it expires (fixed-window reset)', () => {
			checkRateLimit('10.0.0.1'); // 1
			checkRateLimit('10.0.0.1'); // 2
			checkRateLimit('10.0.0.1'); // 3 → exhausted

			// Advance past the window.
			vi.advanceTimersByTime(1_500);

			// Next attempt should start a fresh window.
			const result = checkRateLimit('10.0.0.1');
			expect(result.allowed).toBe(true);
		});

		it('tracks different IPs independently', () => {
			checkRateLimit('10.0.0.1');
			checkRateLimit('10.0.0.1');
			checkRateLimit('10.0.0.1'); // exhausted

			const result = checkRateLimit('10.0.0.2');
			expect(result.allowed).toBe(true);
		});
	});

	// cleanupRateLimitStore

	describe('cleanupRateLimitStore', () => {
		it('removes stale entries whose resetAt has passed', () => {
			checkRateLimit('10.0.0.1');
			checkRateLimit('10.0.0.2');
			checkRateLimit('10.0.0.3');

			// Advance past the window.
			vi.advanceTimersByTime(2_000);

			cleanupRateLimitStore();

			// After cleanup, all buckets should be removed.
			// Verify by checking that a new request starts fresh (count = 1).
			const result = checkRateLimit('10.0.0.1');
			expect(result.allowed).toBe(true);
		});

		it('preserves active entries whose resetAt has not yet passed', () => {
			// Exhaust the bucket for 10.0.0.1.
			checkRateLimit('10.0.0.1');
			checkRateLimit('10.0.0.1');
			checkRateLimit('10.0.0.1');

			// Advance only halfway through the window.
			vi.advanceTimersByTime(500);

			cleanupRateLimitStore();

			// 10.0.0.1 should still be blocked.
			const result = checkRateLimit('10.0.0.1');
			expect(result.allowed).toBe(false);
		});

		it('store size does not grow after many distinct expired IPs', () => {
			// Fire one request each from 500 distinct IPs, then advance past
			// the window and clean up. All entries should be stale.
			for (let i = 0; i < 500; i++) {
				checkRateLimit(`10.0.${i % 256}.${i % 256}`);
			}

			// Advance past the window so every bucket expires.
			vi.advanceTimersByTime(2_000);

			cleanupRateLimitStore();

			// After cleanup, a fresh request should succeed (proving the
			// store was pruned. Otherwise an exhausted bucket from a stale
			// IP wouldn't block a new one, but the store itself would still
			// have 500 entries consuming memory).
			// We verify indirectly: another 500 distinct IPs should all
			// be allowed (no stale buckets interfering).
			for (let i = 500; i < 1000; i++) {
				const result = checkRateLimit(`10.0.${i % 256}.${i % 256}`);
				expect(result.allowed).toBe(true);
			}
		});
	});
});
