<script lang="ts">
	/**
	 * The row a list ends with when the plugin left older records out because
	 * this install reads only a recent window of them.
	 *
	 * The count and the window are the plugin's, from its own list answer, so
	 * the row never states a number the admin holds. It is styled as a refusal
	 * rather than as an empty state: the records exist and are kept, and the
	 * license decides whether they are read. A page that can try to open one
	 * passes `children`, typically a form whose 402 the page renders with
	 * RefusalNotice.
	 */
	import type { Snippet } from 'svelte';
	import { Lock } from '@lucide/svelte';
	import { ICON } from '$lib/icon';
	import { formatCount } from '$lib/format';

	let {
		count,
		noun,
		windowDays = null,
		children,
	}: {
		/** How many older records the list left out. */
		count: number;
		/** What the records are, plural: "revisions", "events". */
		noun: string;
		/** The window the install reads, in days, when the plugin said. */
		windowDays?: number | null;
		children?: Snippet;
	} = $props();

	const label = $derived(`${formatCount(count)} older ${count === 1 ? noun.replace(/s$/, '') : noun}`);
	const span = $derived(windowDays ? `the last ${windowDays} days` : 'a recent window');
</script>

<div data-testid="older-hidden" class="flex flex-col gap-2 rounded-md bg-warn/10 px-3 py-2 text-xs text-warn">
	<p class="flex items-center gap-1.5 font-medium">
		<Lock size={ICON.xs} aria-hidden="true" />
		{label}
	</p>
	<p>
		This instance reads {span} of them. The older ones are kept and are not enabled for reading on
		this instance.
	</p>
	{#if children}
		<div>{@render children()}</div>
	{/if}
</div>
