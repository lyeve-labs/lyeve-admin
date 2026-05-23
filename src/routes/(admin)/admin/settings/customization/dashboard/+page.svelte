<script lang="ts">
	import PageTitle from '$lib/components/PageTitle.svelte';
	import {
		Alert,
		Badge,
		Button,
		Card,
		CheckboxGroup,
		EmptyState,
		Input,
		NumberInput,
		PageShell,
		SectionHeading,
		SegmentedControl,
		Select,
		Textarea,
		confirm as confirmDialog,
	} from '@lyeve-labs/ui-kit';
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { ArrowDown, ArrowUp, Eye, LayoutDashboard, Plus, RotateCcw, Trash2 } from '@lucide/svelte';
	import { ICON } from '$lib/icon';
	import DashboardWidgets from '$lib/components/custom/DashboardWidgets.svelte';
	import { ROLE_CHOICES } from '$lib/api/customization';
	import {
		MAX_WIDGETS,
		MAX_WIDGET_ROWS,
		WIDGET_KINDS,
		WIDTH_LABEL,
		editableWidget,
		newWidget,
		starterLayout,
		widgetKind,
		widgetServed,
		wireWidget,
		type Widget,
		type WidgetType,
		type WidgetWidth,
		type WidgetWindow,
	} from '$lib/api/custom-dashboard';
	import { formatDateTime } from '$lib/format';
	import type { ResolvedWidget } from '$lib/api/custom-dashboard';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	/*
	 * The layout is edited as one document and sent whole, the way a custom
	 * page is: a reorder and an edit land together, and the engine validates
	 * the layout it will store rather than a half of it.
	 */
	// Seeded from the load so the server renders the layout, and copied again
	// whenever the load reruns, after a save or a reset.
	// svelte-ignore state_referenced_locally
	let widgets = $state<Widget[]>(data.layout.widgets.map(editableWidget));
	$effect.pre(() => {
		widgets = data.layout.widgets.map(editableWidget);
	});
	let saving = $state(false);
	let previewing = $state(false);
	let previewAs = $state('admin');

	const kinds = $derived(WIDGET_KINDS.filter((k) => widgetServed(k, data.plugins)));
	const roleOptions = ROLE_CHOICES.map((r) => ({ value: r, label: r }));
	const schemaOptions = $derived(data.schemas.map((s) => ({ value: s, label: s })));
	const anySchema = $derived([{ value: '', label: 'Every schema' }, ...schemaOptions]);
	const widthOptions = (['third', 'half', 'full'] as WidgetWidth[]).map((w) => ({ value: w, label: WIDTH_LABEL[w] }));
	const windowOptions = (['6h', '24h', '7d'] as WidgetWindow[]).map((w) => ({ value: w, label: w }));
	const statusOptions = [
		{ value: '', label: 'Any status' },
		{ value: 'published', label: 'Published' },
		{ value: 'draft', label: 'Draft' },
		{ value: 'archived', label: 'Archived' },
	];
	const toneOptions = [
		{ value: '', label: 'Plain' },
		{ value: 'brand', label: 'Brand' },
		{ value: 'neutral', label: 'Neutral' },
		{ value: 'success', label: 'Success' },
		{ value: 'warn', label: 'Warning' },
		{ value: 'danger', label: 'Danger' },
	];
	const previewRoles = ROLE_CHOICES.map((r) => ({ value: r, label: r }));

	const full = $derived(widgets.length >= MAX_WIDGETS);
	const wire = $derived(JSON.stringify(widgets.map(wireWidget)));
	const preview = $derived((form as { preview?: ResolvedWidget[] } | null)?.preview ?? null);

	/** A label as it reads mid-sentence: lower case, except an acronym such as API. */
	function inSentence(label: string): string {
		return /^[A-Z]{2}/.test(label) ? label : label.charAt(0).toLowerCase() + label.slice(1);
	}

	function add(type: WidgetType) {
		if (full) return;
		widgets = [...widgets, newWidget(type, widgets.map((w) => w.id), data.schemas)];
	}
	function startFromStock() {
		widgets = starterLayout(data.schemas, data.plugins);
	}
	function move(i: number, by: number) {
		const j = i + by;
		if (j < 0 || j >= widgets.length) return;
		const next = [...widgets];
		[next[i], next[j]] = [next[j], next[i]];
		widgets = next;
	}
	function remove(i: number) {
		widgets = widgets.filter((_, k) => k !== i);
	}

	const save: SubmitFunction = () => {
		saving = true;
		return async ({ update }) => {
			saving = false;
			await update({ reset: false, invalidateAll: true });
		};
	};
	const runPreview: SubmitFunction = () => {
		previewing = true;
		return async ({ update }) => {
			previewing = false;
			await update({ reset: false, invalidateAll: false });
		};
	};
	const confirmReset: SubmitFunction = async ({ cancel }) => {
		const ok = await confirmDialog(
			'Reset the dashboard?',
			'Everyone in this tenant goes back to the stock dashboard, and this layout is deleted.',
			{ confirmLabel: 'Reset' },
		);
		if (!ok) {
			cancel();
			return;
		}
		return async ({ update }) => update({ reset: false, invalidateAll: true });
	};
</script>

<PageTitle title="Dashboard - Customization" />

<PageShell
	title="Dashboard"
	description="Compose the dashboard this tenant opens on, from widgets over data the admin already has. Each widget can be limited to roles."
	width="wide"
	back={{ href: '/admin/settings/customization', label: 'Customization' }}
>
	{#snippet actions()}
		<Badge tone="violet" size="sm">Beta</Badge>
		<Button variant="secondary" size="sm" href="/admin">
			<LayoutDashboard size={ICON.sm} /> View dashboard
		</Button>
	{/snippet}

	{#if form?.error}
		<Alert tone="danger">{form.error}</Alert>
	{:else if form && 'saved' in form}
		<Alert tone="success" autoDismiss>Saved. Everyone in this tenant sees this dashboard now, each with the widgets their role allows.</Alert>
	{:else if form && 'reset' in form}
		<Alert tone="success" autoDismiss>Reset. The stock dashboard is back.</Alert>
	{/if}

	<p class="text-sm text-muted" data-testid="layout-state">
		{#if data.layout.custom}
			This tenant shows its own dashboard of {data.layout.widgets.length}
			{data.layout.widgets.length === 1 ? 'widget' : 'widgets'}{#if data.layout.updated_at}, saved {formatDateTime(data.layout.updated_at)}{/if}.
		{:else}
			This tenant shows the stock dashboard. Saving a layout replaces it. A reset brings it back.
		{/if}
	</p>

	<section class="flex flex-col gap-4">
		<SectionHeading level={2}>Widgets</SectionHeading>
		{#if widgets.length === 0}
			<EmptyState
				title="No widgets yet"
				description="Start from a layout close to the stock dashboard and change it, or add widgets one at a time from the list below."
			>
				{#snippet action()}
					<Button variant="secondary" onclick={startFromStock}>
						<Plus size={ICON.sm} /> Start from the stock layout
					</Button>
				{/snippet}
			</EmptyState>
		{:else}
			{#each widgets as w, i (w.id)}
				{@const kind = widgetKind(w.type)}
				<Card pad="md">
					{#snippet header()}
						<div class="flex items-center justify-between gap-2">
							<SectionHeading level={3}>{i + 1}. {kind.label}</SectionHeading>
							<div class="flex items-center gap-1">
								<Button variant="ghost" size="sm" type="button" aria-label="Move widget {i + 1} up" disabled={i === 0} onclick={() => move(i, -1)}>
									<ArrowUp size={ICON.sm} />
								</Button>
								<Button variant="ghost" size="sm" type="button" aria-label="Move widget {i + 1} down" disabled={i === widgets.length - 1} onclick={() => move(i, 1)}>
									<ArrowDown size={ICON.sm} />
								</Button>
								<Button variant="ghost" size="sm" type="button" aria-label="Remove widget {i + 1}" onclick={() => remove(i)}>
									<Trash2 size={ICON.sm} class="text-danger" />
								</Button>
							</div>
						</div>
					{/snippet}
					<div class="flex flex-col gap-4">
						<p class="text-sm text-muted">
							{kind.description}
							{#if kind.adminData}
								Its data is an admin's to read: a viewer or editor shown this widget sees it say it could not be read.
							{/if}
						</p>
						<div class="grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
							<Input id="widget-{w.id}-title" label="Heading" placeholder={kind.fallbackTitle || 'None'} bind:value={w.title} />
							<SegmentedControl label="Width" options={widthOptions} value={w.width ?? 'half'} onchange={(v) => (w.width = v)} />
							<CheckboxGroup label="Seen by" hint="Leave empty for everyone." orientation="horizontal" options={roleOptions} bind:value={w.roles} />
						</div>

						{#if w.type === 'entry_counts'}
							{#if schemaOptions.length === 0}
								<p class="text-sm text-muted">This tenant has no schemas to count yet.</p>
							{:else}
								<CheckboxGroup label="Schemas" hint="Up to 12, in the order listed here." orientation="horizontal" options={schemaOptions} bind:value={w.schemas} />
							{/if}
						{:else if w.type === 'latest_entries'}
							<div class="grid grid-cols-1 items-start gap-4 sm:grid-cols-3">
								<Select id="widget-{w.id}-schema" label="Schema" options={anySchema} bind:value={w.schema} />
								<Select id="widget-{w.id}-status" label="Status" options={statusOptions} bind:value={w.status} />
								<NumberInput id="widget-{w.id}-limit" label="Entries" min={1} max={MAX_WIDGET_ROWS} bind:value={w.limit} />
							</div>
						{:else if w.type === 'status_breakdown'}
							<div class="grid grid-cols-1 items-start gap-4 sm:grid-cols-3">
								<Select id="widget-{w.id}-schema" label="Schema" options={anySchema} bind:value={w.schema} />
							</div>
						{:else if w.type === 'recent_activity'}
							<div class="grid grid-cols-1 items-start gap-4 sm:grid-cols-3">
								<NumberInput id="widget-{w.id}-limit" label="Entries" min={1} max={MAX_WIDGET_ROWS} bind:value={w.limit} />
							</div>
						{:else if w.type === 'api_usage'}
							<SegmentedControl label="Window" options={windowOptions} value={w.window ?? '24h'} onchange={(v) => (w.window = v)} />
						{:else if w.type === 'text'}
							<div class="grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
								<div class="lg:col-span-2">
									<Textarea id="widget-{w.id}-body" label="Text" rows={5} mono hint="Markdown: headings, lists, links, bold, italic and code." bind:value={w.body} />
								</div>
								<Select id="widget-{w.id}-tone" label="Style" options={toneOptions} bind:value={w.tone} />
							</div>
						{:else if w.type === 'links'}
							<div class="flex flex-col gap-3">
								{#each w.links ?? [] as link, j (j)}
									<div class="grid grid-cols-1 items-end gap-3 sm:grid-cols-[1fr_2fr_auto]">
										<Input id="widget-{w.id}-link-{j}-label" label="Label" bind:value={link.label} />
										<Input id="widget-{w.id}-link-{j}-url" label="Address" mono bind:value={link.url} />
										<div class="flex h-control items-center">
											<Button variant="ghost" size="sm" type="button" aria-label="Remove link {j + 1}" onclick={() => (w.links = (w.links ?? []).filter((_, k) => k !== j))}>
												<Trash2 size={ICON.sm} class="text-danger" />
											</Button>
										</div>
									</div>
								{/each}
								<p class="text-xs text-faint">An address is an https URL, or an admin path starting /admin/.</p>
								<div>
									<Button variant="secondary" size="sm" type="button" onclick={() => (w.links = [...(w.links ?? []), { label: '', url: 'https://' }])}>
										<Plus size={ICON.sm} /> Add link
									</Button>
								</div>
							</div>
						{/if}
					</div>
				</Card>
			{/each}
		{/if}
	</section>

	<section class="flex flex-col gap-3">
		<SectionHeading level={2}>Add a widget</SectionHeading>
		{#if full}
			<p class="text-sm text-muted">A dashboard holds at most {MAX_WIDGETS} widgets. Remove one to add another.</p>
		{:else}
			<ul class="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
				{#each kinds as k (k.type)}
					<li class="flex flex-col justify-between gap-3 rounded-xl border border-line-strong bg-surface p-4">
						<div class="flex flex-col gap-1">
							<span class="text-sm font-medium text-fg">{k.label}</span>
							<span class="text-xs text-muted">{k.description}</span>
						</div>
						<div>
							<Button variant="secondary" size="sm" type="button" onclick={() => add(k.type)}>
								<Plus size={ICON.sm} /> Add {inSentence(k.label)}
							</Button>
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<div class="flex flex-wrap items-center gap-2">
		<form method="POST" action="?/save" use:enhance={save}>
			<input type="hidden" name="widgets" value={wire} />
			<Button variant="primary" type="submit" loading={saving} disabled={widgets.length === 0}>Save</Button>
		</form>
		{#if data.layout.custom}
			<form method="POST" action="?/reset" use:enhance={confirmReset}>
				<Button variant="secondary" type="submit"><RotateCcw size={ICON.sm} /> Reset to the stock dashboard</Button>
			</form>
		{/if}
	</div>

	<section class="flex flex-col gap-4">
		<div class="flex flex-wrap items-end justify-between gap-3">
			<div class="flex flex-col gap-1">
				<SectionHeading level={2}>Preview</SectionHeading>
				<p class="text-sm text-muted">The layout above, unsaved, as one role sees it. The numbers are read with your own access.</p>
			</div>
			<form method="POST" action="?/preview" class="flex items-end gap-2" use:enhance={runPreview}>
				<input type="hidden" name="widgets" value={wire} />
				<input type="hidden" name="as" value={previewAs} />
				<SegmentedControl label="Preview as" labelHidden size="sm" options={previewRoles} bind:value={previewAs} />
				<Button variant="secondary" size="sm" type="submit" loading={previewing} disabled={widgets.length === 0}>
					<Eye size={ICON.sm} /> Preview
				</Button>
			</form>
		</div>
		{#if preview}
			<div class="rounded-xl border border-dashed border-line-strong p-4" data-testid="dashboard-preview">
				{#if preview.length === 0}
					<p class="text-sm text-muted">A {(form as { previewAs?: string }).previewAs} sees no widget on this layout.</p>
				{:else}
					<DashboardWidgets widgets={preview} />
				{/if}
			</div>
		{:else}
			<p class="text-sm text-faint">Nothing previewed yet.</p>
		{/if}
	</section>
</PageShell>
