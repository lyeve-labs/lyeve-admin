/** Duration formatting for run lists. The relative clock lives in $lib/format,
 * beside the absolute one, because which register a surface uses is a decision. */


/** `12 ms`, `1.4 s`, `2m 05s`. */
export function formatDuration(ms: number | null | undefined): string {
	if (ms === null || ms === undefined || !Number.isFinite(ms)) return '';
	if (ms < 1000) return `${Math.round(ms)} ms`;
	if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
	const minutes = Math.floor(ms / 60_000);
	const seconds = Math.round((ms % 60_000) / 1000);
	return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}
