import type { OnNavigate } from '@sveltejs/kit';

/** Set on the document element while a route change fades. app.css reads it. */
export const FADING = 'data-page-fading';

let running = 0;

/**
 * Fades the page on a route change. Pass it to SvelteKit's onNavigate.
 *
 * The browser snapshots the old and the new page and cross-fades them. While
 * that runs, app.css names the content region, so the sidebar and the header
 * stay put and only the page moves. The name comes off again afterward,
 * because a named element is a stacking context of its own and would change
 * how anything inside it layers.
 *
 * A change of query alone, such as a filter or a page of results, keeps the
 * reader in place and does not fade. Under reduced motion the kit's stylesheet
 * finishes the transition in 1ms, so it is not checked here. In a browser
 * without view transitions, the page swaps as it always did.
 */
export function fadeRouteChange(navigation: OnNavigate): Promise<void> | undefined {
	if (typeof document === 'undefined' || !document.startViewTransition) return;
	if (navigation.from?.url.pathname === navigation.to?.url.pathname) return;

	const root = document.documentElement;
	running += 1;
	root.setAttribute(FADING, '');
	return new Promise((resolve) => {
		const transition = document.startViewTransition(async () => {
			resolve();
			await navigation.complete;
		});
		// A navigation that fails or gives way to another ends its fade early.
		// That is not an error worth reporting.
		transition.ready.catch(() => {});
		transition.updateCallbackDone.catch(() => {});
		transition.finished
			.catch(() => {})
			.finally(() => {
				running -= 1;
				if (running === 0) root.removeAttribute(FADING);
			});
	});
}
