import type { OnNavigate } from '@sveltejs/kit';

/**
 * Fades the page on a route change. Pass it to SvelteKit's onNavigate.
 *
 * The browser snapshots the old and the new page, and app.css fades the new
 * one in over the old.
 *
 * A change of query alone, such as a filter or a page of results, keeps the
 * reader in place and does not fade. Under reduced motion the kit's stylesheet
 * finishes the transition in 1ms, so it is not checked here. In a browser
 * without view transitions, the page swaps as it always did.
 */
export function fadeRouteChange(navigation: OnNavigate): Promise<void> | undefined {
	if (typeof document === 'undefined' || !document.startViewTransition) return;
	if (navigation.from?.url.pathname === navigation.to?.url.pathname) return;

	return new Promise((resolve) => {
		const transition = document.startViewTransition(async () => {
			resolve();
			await navigation.complete;
		});
		// A navigation that fails or gives way to another ends its fade early.
		// That is not an error worth reporting.
		transition.ready.catch(() => {});
		transition.updateCallbackDone.catch(() => {});
		transition.finished.catch(() => {});
	});
}
