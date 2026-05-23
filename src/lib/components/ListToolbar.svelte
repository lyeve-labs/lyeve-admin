<script lang="ts">
	/**
	 * The one row above every list: the search at the leading edge, the filters
	 * pushed to the trailing edge.
	 *
	 * A list that builds this row by hand picks its own place for the search,
	 * its own side for the filters, and whether a phone gets a horizontal
	 * scrollbar. The order is fixed here so a page cannot choose it,
	 * and the search takes the whole first row below `md` so the filters wrap
	 * to a second row instead of squeezing the box to nothing.
	 */
	import type { Snippet } from 'svelte';
	import { Toolbar } from '@lyeve-labs/ui-kit';

	interface Props {
		/** The accessible name, so a reader can tell this toolbar from the page's others. */
		label: string;
		/** The search control, or the page's one text filter. */
		search?: Snippet;
		/** Segmented controls, selects and date pickers, trailing. */
		filters?: Snippet;
		class?: string;
	}

	let { label, search, filters, class: klass = '' }: Props = $props();
</script>

<Toolbar {label} class={klass} actions={filters ? trailing : undefined}>
	{#if search}
		<div class="w-full min-w-0 md:w-auto md:max-w-md md:flex-1" data-slot="search">
			{@render search()}
		</div>
	{/if}
</Toolbar>

<!-- A segmented control with six chips is wider than a phone. Its segments
     keep their words on one line and that control alone scrolls sideways under
     a finger, which is how a wrapped chip row stops looking like six broken
     buttons.

     The scroll is on the control and never on the row. A scroll container
     clips anything absolutely positioned inside it, and every panel the kit
     paints is absolute, so a row-level overflow would cut each Select's open
     list down to a sliver. role="group" is not the hook: Select marks its own
     option groups with it and DateTimePicker marks the control that opens a
     calendar, so scrolling on that selector would clip the two panels it is
     supposed to protect. -->
{#snippet trailing()}
	<div
		class="flex max-w-full flex-wrap items-center gap-2 [&_[role=group]]:whitespace-nowrap [&_[role=radiogroup]]:max-w-full [&_[role=radiogroup]]:overflow-x-auto [&_[role=radiogroup]]:whitespace-nowrap"
		data-slot="filters"
	>
		{@render filters?.()}
	</div>
{/snippet}
