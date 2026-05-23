<script lang="ts">
	/**
	 * Where a cover crop of this image centers. A click on the image places
	 * the point, the arrow keys nudge it, and Save writes it through the
	 * page's form action. Setting one needs no capability.
	 */
	import { Alert, Button, SectionHeading } from '@lyeve-labs/ui-kit';
	import { enhance } from '$app/forms';
	import { submitter } from '$lib/forms.svelte';
	import { focalAt, type FocalPoint } from '$lib/api/media';

	interface Props {
		id: string;
		src: string;
		alt: string;
		/** The point the file stores, or null for the center. */
		stored: FocalPoint | null;
		error?: string;
		saved?: boolean;
	}

	let { id, src, alt, stored, error = '', saved = false }: Props = $props();

	// svelte-ignore state_referenced_locally
	let point = $state<FocalPoint>(stored ?? { x: 0.5, y: 0.5 });
	let shownId = '';
	$effect(() => {
		if (id !== shownId) {
			shownId = id;
			point = stored ?? { x: 0.5, y: 0.5 };
		}
	});

	const placeLabel = $derived(
		`Focal point at ${Math.round(point.x * 100)}% across and ${Math.round(point.y * 100)}% down. Click or use the arrow keys to move it.`,
	);
	const changed = $derived(!stored || stored.x !== point.x || stored.y !== point.y);
	const save = submitter();

	function place(e: MouseEvent) {
		const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
		if (box.width === 0 || box.height === 0) return;
		point = focalAt((e.clientX - box.left) / box.width, (e.clientY - box.top) / box.height);
	}

	const STEP = 0.05;
	function nudge(e: KeyboardEvent) {
		const moves: Record<string, [number, number]> = {
			ArrowLeft: [-STEP, 0],
			ArrowRight: [STEP, 0],
			ArrowUp: [0, -STEP],
			ArrowDown: [0, STEP],
		};
		const m = moves[e.key];
		if (!m) return;
		e.preventDefault();
		point = focalAt(point.x + m[0], point.y + m[1]);
	}
</script>

<div class="flex flex-col gap-3" data-testid="focal-point">
	<SectionHeading level={3}>Focal point</SectionHeading>
	<p class="text-xs text-muted">Click where a cropped version should center. The arrow keys move the point.</p>
	{#if error}
		<Alert tone="danger">{error}</Alert>
	{:else if saved}
		<Alert tone="success" autoDismiss>Focal point saved. Crops cut around the old one are made again.</Alert>
	{/if}
	<button
		type="button"
		class="relative block w-full overflow-hidden rounded-lg bg-surface-2/50 outline-none focus-visible:ring-2 focus-visible:ring-brand"
		aria-label={placeLabel}
		onclick={place}
		onkeydown={nudge}
	>
		<img {src} {alt} class="block max-h-72 w-full object-contain" draggable="false" />
		<span
			aria-hidden="true"
			class="pointer-events-none absolute size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-fg bg-brand/60 shadow"
			style="left: {point.x * 100}%; top: {point.y * 100}%"
		></span>
	</button>
	<div class="flex flex-wrap items-center gap-2">
		<form method="POST" action="?/focal" use:enhance={save.enhance} class="contents">
			<input type="hidden" name="id" value={id} />
			<input type="hidden" name="x" value={point.x} />
			<input type="hidden" name="y" value={point.y} />
			<Button variant="secondary" size="sm" type="submit" disabled={!changed} loading={save.pending}>Save focal point</Button>
		</form>
		{#if stored}
			<form method="POST" action="?/focal" use:enhance class="contents">
				<input type="hidden" name="id" value={id} />
				<input type="hidden" name="clear" value="true" />
				<Button variant="ghost" size="sm" type="submit">Reset to center</Button>
			</form>
		{/if}
		<span class="font-mono text-xs text-faint">{point.x.toFixed(2)}, {point.y.toFixed(2)}</span>
	</div>
</div>
