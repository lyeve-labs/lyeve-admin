<script lang="ts">
	import { Button, SectionHeading } from '@lyeve-labs/ui-kit';
	import { Lock, LockOpen, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from '@lucide/svelte';
	import { untrack, type Snippet } from 'svelte';
	import { clampWidth, readAside, writeAside } from '$lib/aside';
	import { ICON } from '$lib/icon';

	/**
	 * A column docked to one side of a page, with one width discipline for
	 * every page that has one. Above the breakpoint its inner edge drags, a
	 * lock fixes the width, the keyboard nudges by a step, and the width and
	 * the lock are remembered per viewer. A collapsible one folds to a strip
	 * carrying its name. Below the breakpoint none of that applies: it stacks
	 * in the page's own flow, hides, or becomes the overlay a toolbar opens,
	 * as the page decides. The drag overlays the width while the pointer
	 * moves and writes once on release.
	 *
	 * Written once so the flow editor's panels, the schema list and the API
	 * reference's nav share one column behavior.
	 */
	type Breakpoint = 'md' | 'lg' | 'xl';

	interface Props {
		/** The localStorage key the width and lock are kept under. */
		storageKey: string;
		/** The word on the strip and the header. */
		label: string;
		/** Which edge of the page it docks to. The handle sits on the other edge. */
		side: 'start' | 'end';
		/** The width it opens at until somebody drags it. */
		width?: number;
		min?: number;
		max?: number;
		/** Where the desktop controls start. */
		breakpoint?: Breakpoint;
		/**
		 * What it does under the breakpoint: stays in the page's flow across
		 * the full width, disappears, or floats over the page while `overlay`
		 * is set.
		 */
		below?: 'stack' | 'overlay' | 'hidden';
		/** Shown as an overlay below the breakpoint. Only read with `below="overlay"`. */
		overlay?: boolean;
		/** Offers a collapse to a strip. */
		collapsible?: boolean;
		/** Expanded above the breakpoint. Bindable so a page can open it from an offer. */
		open?: boolean;
		/** Keeps the header's count or status beside the label. */
		meta?: Snippet;
		/** Classes for the aside element itself, for the stacked layout's share of the height. */
		class?: string;
		testId?: string;
		children: Snippet;
	}

	let {
		storageKey,
		label,
		side,
		width: defaultWidth = 280,
		min = 200,
		max = 560,
		breakpoint = 'xl',
		below = 'stack',
		overlay = false,
		collapsible = false,
		open = $bindable(true),
		meta,
		class: klass = '',
		testId,
		children,
	}: Props = $props();

	// Tailwind reads class names from source, so each breakpoint spells its
	// variants out rather than building them from the prop.
	const AT: Record<Breakpoint, Record<'dock' | 'w8' | 'strip' | 'flex' | 'block' | 'hidden' | 'width' | 'noBorderB' | 'borderR' | 'borderL' | 'flexNone' | 'maxHNone', string>> = {
		md: {
			dock: 'md:static md:z-auto md:block',
			w8: 'md:w-8',
			strip: 'md:flex',
			flex: 'md:flex',
			block: 'md:block',
			hidden: 'md:hidden',
			width: 'md:w-(--panel-w)',
			noBorderB: 'md:border-b-0',
			borderR: 'md:border-r',
			borderL: 'md:border-l',
			flexNone: 'md:flex-none',
			maxHNone: 'md:max-h-none',
		},
		lg: {
			dock: 'lg:static lg:z-auto lg:block',
			w8: 'lg:w-8',
			strip: 'lg:flex',
			flex: 'lg:flex',
			block: 'lg:block',
			hidden: 'lg:hidden',
			width: 'lg:w-(--panel-w)',
			noBorderB: 'lg:border-b-0',
			borderR: 'lg:border-r',
			borderL: 'lg:border-l',
			flexNone: 'lg:flex-none',
			maxHNone: 'lg:max-h-none',
		},
		xl: {
			dock: 'xl:static xl:z-auto xl:block',
			w8: 'xl:w-8',
			strip: 'xl:flex',
			flex: 'xl:flex',
			block: 'xl:block',
			hidden: 'xl:hidden',
			width: 'xl:w-(--panel-w)',
			noBorderB: 'xl:border-b-0',
			borderR: 'xl:border-r',
			borderL: 'xl:border-l',
			flexNone: 'xl:flex-none',
			maxHNone: 'xl:max-h-none',
		},
	};
	const at = $derived(AT[breakpoint]);
	const id = $derived(testId ?? `aside-${storageKey}`);

	function storage(): Storage | null {
		try {
			return typeof localStorage === 'undefined' ? null : localStorage;
		} catch {
			return null;
		}
	}

	const bounds = $derived({ width: defaultWidth, min, max });

	// The key never changes for the life of the aside, so the read happens
	// once, at mount.
	const initial = readAside(
		storage(),
		untrack(() => storageKey),
		untrack(() => bounds)
	);
	let width = $state(initial.width);
	let locked = $state(initial.locked);

	let drag = $state<{ startX: number; startWidth: number } | null>(null);

	/** The inner edge is to the right of a start aside and to the left of an end aside. */
	const grows = $derived(side === 'start' ? 1 : -1);

	function remember() {
		writeAside(storage(), storageKey, bounds, { width, locked });
	}

	function startResize(e: PointerEvent) {
		if (e.button !== 0) return;
		e.preventDefault();
		drag = { startX: e.clientX, startWidth: width };
		(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
	}

	function resizeMove(e: PointerEvent) {
		if (!drag) return;
		width = clampWidth(bounds, drag.startWidth + (e.clientX - drag.startX) * grows);
	}

	function endResize(e: PointerEvent) {
		if (!drag) return;
		drag = null;
		(e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
		remember();
	}

	function resizeKey(e: KeyboardEvent) {
		const step = e.shiftKey ? 80 : 24;
		let delta = 0;
		if (e.key === 'ArrowRight') delta = step * grows;
		else if (e.key === 'ArrowLeft') delta = -step * grows;
		if (delta === 0) return;
		e.preventDefault();
		width = clampWidth(bounds, width + delta);
		remember();
	}

	function toggleLock() {
		locked = !locked;
		remember();
	}

	const Collapse = $derived(side === 'start' ? PanelLeftClose : PanelRightClose);
	const Expand = $derived(side === 'start' ? PanelLeftOpen : PanelRightOpen);

	/** The strip is the only thing a collapsed aside shows, and only above the breakpoint. */
	const folded = $derived(collapsible && !open);

	const edge = $derived(side === 'start' ? at.borderR : at.borderL);

	const frame = $derived.by(() => {
		if (below === 'overlay') {
			// Floating under the breakpoint at the panel's own width. Only the
			// docked variant folds to the strip.
			return `absolute inset-y-0 z-20 w-(--panel-w) max-w-full shrink-0 border-line bg-surface ${at.dock} ${folded ? at.w8 : ''} ${side === 'start' ? 'left-0 border-r' : 'right-0 border-l'} ${overlay ? '' : 'hidden'}`;
		}
		const shown = below === 'hidden' ? `hidden ${at.flex}` : `flex border-b ${at.noBorderB} ${at.flexNone} ${at.maxHNone}`;
		return `${shown} min-h-0 flex-col border-line bg-surface ${folded ? at.w8 : at.width} ${edge} ${klass}`;
	});
</script>

<aside class={frame} style="--panel-w:{width}px" aria-label={label} data-testid={id} data-open={open} data-locked={locked}>
	{#if collapsible}
		<!-- The strip: the name read down the edge and the one control that brings the aside back. -->
		<div class="h-full flex-col items-center gap-2 py-1 {folded ? `hidden ${at.strip}` : 'hidden'}" data-testid="{id}-strip">
			<Button variant="ghost" size="sm" aria-label="Expand {label}" aria-expanded={false} hint={false} onclick={() => (open = true)}>
				<Expand size={ICON.sm} />
			</Button>
			<span class="text-xs font-medium uppercase tracking-wide text-faint [writing-mode:vertical-rl]">{label}</span>
		</div>
	{/if}

	<div class="relative flex h-full min-h-0 flex-1 flex-col {folded ? at.hidden : ''}">
		<div class="flex h-9 shrink-0 items-center justify-between border-b border-line pl-3 pr-1">
			<SectionHeading level={2} variant="eyebrow" actions={meta}>{label}</SectionHeading>
			<div class="hidden items-center {at.flex}">
				<Button
					variant="ghost"
					size="sm"
					aria-label={locked ? `Unlock ${label} width` : `Lock ${label} width`}
					aria-pressed={locked}
					hint={false}
					onclick={toggleLock}
				>
					{#if locked}<Lock size={ICON.sm} />{:else}<LockOpen size={ICON.sm} />{/if}
				</Button>
				{#if collapsible}
					<Button variant="ghost" size="sm" aria-label="Collapse {label}" aria-expanded={true} hint={false} onclick={() => (open = false)}>
						<Collapse size={ICON.sm} />
					</Button>
				{/if}
			</div>
		</div>
		<div class="min-h-0 flex-1 overflow-y-auto">
			{@render children()}
		</div>
		{#if !locked}
			<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
			<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
			<div
				class="absolute inset-y-0 z-10 hidden w-2 cursor-col-resize outline-none hover:bg-brand/40 focus-visible:bg-brand/40 {at.block} {side === 'start' ? '-right-1' : '-left-1'} {drag ? 'bg-brand/40' : ''}"
				role="separator"
				aria-orientation="vertical"
				aria-label="Resize {label}"
				aria-valuenow={width}
				aria-valuemin={min}
				aria-valuemax={max}
				tabindex="0"
				data-testid="{id}-handle"
				onpointerdown={startResize}
				onpointermove={resizeMove}
				onpointerup={endResize}
				onpointercancel={endResize}
				onkeydown={resizeKey}
			></div>
		{/if}
	</div>
</aside>
