<script lang="ts">
	import { navigating } from '$app/state';

	/**
	 * A bar across the top of the window while a navigation is in flight.
	 *
	 * Without it, a slow page reads as a dead link and is clicked again.
	 *
	 * It waits before it appears. A navigation that resolves in a frame needs no
	 * announcement, and a bar that flashes on every click is worse than no bar:
	 * the delay is the difference between reporting work and adding noise.
	 *
	 * The track is what carries the signal and the sliding highlight only
	 * decorates it. Reduced motion stops every loop after one pass, which parks
	 * the highlight off screen, so the track has to be visible on its own. A
	 * faint track would leave a reader who asked for reduced motion a strip they
	 * cannot see.
	 */
	const APPEAR_AFTER = 180;

	let visible = $state(false);

	$effect(() => {
		if (!navigating.to) {
			visible = false;
			return;
		}
		const timer = setTimeout(() => (visible = true), APPEAR_AFTER);
		return () => clearTimeout(timer);
	});
</script>

<!-- aria-hidden because the bar says nothing a reader cannot already tell from
     the page they asked for arriving. A live region announcing every navigation
     interrupts the thing it is reporting on. -->
{#if visible}
	<div
		class="fixed inset-x-0 top-0 z-toast h-0.5 overflow-hidden bg-brand/50"
		data-print="hide"
		aria-hidden="true"
	>
		<div class="h-full w-2/5 animate-route-progress rounded-full bg-brand"></div>
	</div>
{/if}
