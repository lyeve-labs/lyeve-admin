/**
 * What the dashboard and its loader agree on: the windows a reader can ask
 * for and the bands a failure rate is judged against. Shared here because the
 * page cannot import a server module and both sides read them.
 */

/** The windows the page can be asked for, and the hours each one spans. */
export const WINDOWS = { '6h': 6, '24h': 24, '7d': 168 } as const;
export type Window = keyof typeof WINDOWS;
export const DEFAULT_WINDOW: Window = '24h';

/** The window a request names, or the default for anything else. */
export function windowOf(url: URL | undefined): Window {
	const asked = url?.searchParams.get('window') ?? '';
	return asked in WINDOWS ? (asked as Window) : DEFAULT_WINDOW;
}

/** The window as the page says it. */
export const WINDOW_LABEL: Record<Window, string> = {
	'6h': '6 hours',
	'24h': '24 hours',
	'7d': '7 days',
};

/** The same bands the analytics page draws its own line at. */
export function trafficTone(rate: number): 'danger' | 'warn' | 'neutral' {
	if (rate >= 0.05) return 'danger';
	if (rate >= 0.01) return 'warn';
	return 'neutral';
}
