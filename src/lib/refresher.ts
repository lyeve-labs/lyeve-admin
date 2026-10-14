/**
 * A page's Refresh button.
 *
 * It reruns the loads that registered `key` with `depends`, which is the
 * page's own load. `invalidateAll` would also mark the shell's data stale, so
 * it would be sent and drawn again, although nothing a Refresh is for lives
 * there.
 */
import { invalidate } from '$app/navigation';

/** The keys the pages register. Each names one page's own load. */
export type RefreshKey = `app:${string}`;

/**
 * The handler for a Refresh button over the loads that depend on `key`.
 * `busy` is told when the reread starts and when it ends, whether it worked
 * or not, so the button can show it.
 */
export function refresher(key: RefreshKey, busy: (on: boolean) => void): () => Promise<void> {
	return async () => {
		busy(true);
		try {
			await invalidate(key);
		} finally {
			busy(false);
		}
	};
}
