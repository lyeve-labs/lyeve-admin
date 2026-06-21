// Simple in-memory per-IP rate limiter for auth endpoints (login, setup, MFA).
// Fixed-window counter: tracks attempts per IP within a configurable window.
// Designed for a single-process BFF. Does not coordinate across replicas.

interface Bucket {
	count: number;
	resetAt: number; // epoch ms
}

const store = new Map<string, Bucket>();

// A deployment behind a reverse proxy, or one whose users share an address,
// counts many callers as one and needs to size this for its own traffic. Absent
// or unusable settings keep the shipped numbers.
function envInt(name: string, fallback: number): number {
	const raw = process.env[name];
	if (!raw) return fallback;
	const n = Number(raw);
	return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const WINDOW_MS = envInt('RATE_LIMIT_AUTH_WINDOW_MS', 60_000); // 60 seconds
export const MAX_ATTEMPTS = envInt('RATE_LIMIT_AUTH_MAX_ATTEMPTS', 10); // generous for normal use, restrictive for brute force

/**
 * Empties the fixed-window store outright. Only the tests need it: the
 * periodic sweep is cleanupRateLimitStore, which drops expired buckets and
 * leaves the live ones counting.
 */
export function resetRateLimitStore(): void {
	store.clear();
}

export function checkRateLimit(ip: string): { allowed: boolean; retryAfterSec: number } {
	const now = Date.now();
	const bucket = store.get(ip);

	if (!bucket || now >= bucket.resetAt) {
		store.set(ip, { count: 1, resetAt: now + WINDOW_MS });
		return { allowed: true, retryAfterSec: 0 };
	}

	if (bucket.count >= MAX_ATTEMPTS) {
		const retryAfterSec = Math.ceil((bucket.resetAt - now) / 1000);
		return { allowed: false, retryAfterSec };
	}

	bucket.count++;
	return { allowed: true, retryAfterSec: 0 };
}

/** Periodic cleanup of stale entries: call sparingly (e.g. via setInterval in prod bootstrap). */
export function cleanupRateLimitStore(): void {
	const now = Date.now();
	for (const [ip, bucket] of store) {
		if (now >= bucket.resetAt) {
			store.delete(ip);
		}
	}
}
