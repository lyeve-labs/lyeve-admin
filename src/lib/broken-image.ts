import type { Action } from 'svelte/action';

/**
 * Reports that an image inside `node` could not be decoded.
 *
 * The obvious place for this is an `onerror` handler on the `<img>` itself,
 * and that is what breaks. Svelte's server renderer stamps
 * `onload="this.__e=event"` and `onerror="this.__e=event"` onto any `<img>`,
 * `<iframe>`, `<link>` or `<script>` carrying an event handler, a spread or a
 * `use:` directive, so events that fire before hydration can be replayed
 * afterwards. The admin is served under `script-src 'self' 'nonce-...'`, and a
 * nonce never covers an event handler attribute, so the browser blocks that
 * snippet and logs a violation for every tile it rendered. Hydration then
 * strips the attributes, which is why the markup looks innocent by the time
 * anyone inspects it.
 *
 * Attaching from a wrapper element keeps the `<img>` free of both, so the
 * server sends no inline handler at all. `error` does not bubble, hence the
 * capture phase, and an image that already failed fires nothing more, so its
 * settled state is read once on attach.
 */
export const brokenImage: Action<HTMLElement, () => void> = (node, onBroken) => {
	let notify = onBroken;

	const flag = (event: Event) => {
		if (event.target instanceof HTMLImageElement) notify();
	};

	node.addEventListener('error', flag, true);

	// An <img> with no src is also `complete` at zero width, so the src has to
	// be part of the test or every placeholder tile reports itself broken.
	const img = node.querySelector('img');
	if (img?.getAttribute('src') && img.complete && img.naturalWidth === 0) notify();

	return {
		update(next: () => void) {
			notify = next;
		},
		destroy() {
			node.removeEventListener('error', flag, true);
		},
	};
};
