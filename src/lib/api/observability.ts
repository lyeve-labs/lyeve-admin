/**
 * Shared shape of the observability page's latency ranking.
 *
 * The row count is a query parameter, so the load function and the control that
 * sets it have to agree on which values exist.
 */

/** Row counts the latency ranking offers. */
export const LATENCY_TOP_CHOICES = [10, 20, 50, 100] as const;

/** What the ranking returns when the URL names no row count. */
export const DEFAULT_LATENCY_TOP = 20;

/** The row count a request asked for, or the default when it asked for nothing the ranking offers. */
export function latencyTop(raw: string | null | undefined): number {
	const n = Number(raw);
	return (LATENCY_TOP_CHOICES as readonly number[]).includes(n) ? n : DEFAULT_LATENCY_TOP;
}
