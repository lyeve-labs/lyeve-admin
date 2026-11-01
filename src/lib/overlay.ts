import { tick } from 'svelte';

/** A dialog or drawer that is playing its exit: Svelte makes a leaving element inert. */
const LEAVING = '[aria-modal="true"][inert]';

/**
 * Resolves once every dialog or drawer that is closing has left the page.
 *
 * The kit's Modal and Drawer play an exit of about 200ms, and the control
 * that opened one takes focus back when it ends. Orca in Chrome can drop a
 * polite announcement that arrives during the exit, in favor of that focus
 * move. A sentence about an outcome that closes an overlay is set after this
 * resolves, once focus has returned.
 *
 * An overlay that stays open is not waited for, because only a leaving one is
 * inert. Without an exit to play, as under reduced motion or in a test, the
 * overlay is already gone and this resolves on the next update.
 */
export async function overlayClosed(): Promise<void> {
	await tick();
	if (!document.querySelector(LEAVING)) return;
	await new Promise<void>((resolve) => {
		const observer = new MutationObserver(() => {
			if (document.querySelector(LEAVING)) return;
			observer.disconnect();
			resolve();
		});
		observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['inert'] });
	});
}
