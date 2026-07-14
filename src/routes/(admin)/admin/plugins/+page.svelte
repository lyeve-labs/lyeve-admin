<script lang="ts">
	import PageTitle from '$lib/components/PageTitle.svelte';
	/**
	 * Every plugin the engine reports, with the state it reports.
	 *
	 * The rows come from the plugin status alone: the engine names each plugin
	 * compiled into it and says whether it runs, and each plugin describes
	 * itself. `[name]` stays a route because it holds the routes a plugin
	 * serves and the requests it handled, which is a document rather than a row.
	 */
	import {
		Alert,
		Badge,
		Button,
		Card,
		CheckboxGroup,
		EmptyState,
		PageShell,
		SearchInput,
		SectionHeading,
		Select,
		type ChoiceOption
	} from '@lyeve-labs/ui-kit';
	import {
		Check,
		ExternalLink,
		Filter,
		KeyRound,
		Lock,
		OctagonAlert,
		PackageX,
		PowerOff,
		Puzzle
	} from '@lucide/svelte';
	import type { PageData } from './$types';
	import { CATEGORY_LABEL, CATEGORY_ORDER } from '$lib/plugin-categories';
	import {
		buildRows,
		failedCount,
		filterRows,
		groupRows,
		PLUGIN_STATES,
		runningCounts,
		STATE_LABEL,
		STATE_TONE,
		type PluginRow,
		type PluginState
	} from '$lib/plugin-rows';
	import ListToolbar from '$lib/components/ListToolbar.svelte';
	import { hasLicenseModule } from '$lib/entitlements';
	import { ICON } from '$lib/icon';
	import { isExternalHref } from '$lib/links';

	let { data }: { data: PageData } = $props();

	// The license page is the license module's, so a build that links none
	// offers no way there.
	const licensePage = $derived(hasLicenseModule(data.entitlements));

	const rows = $derived(buildRows(data.plugins ?? []));
	const counts = $derived(runningCounts(rows));
	const failed = $derived(failedCount(rows));

	const summary = $derived.by(() => {
		if (data.error) return 'The plugins this engine carries, and whether each one runs.';
		if (counts.compiled === 0) return 'This engine carries no plugins.';
		const noun = counts.compiled === 1 ? 'plugin' : 'plugins';
		return `${counts.running} of ${counts.compiled} ${noun} running`;
	});

	// Only the groups a plugin is filed under, so no choice empties the list.
	const categoryOptions = $derived([
		{ value: '', label: 'All categories' },
		...CATEGORY_ORDER.filter((c) => rows.some((r) => r.category === c)).map((c) => ({
			value: c,
			label: CATEGORY_LABEL[c]
		}))
	]);
	const STATE_OPTIONS: ChoiceOption[] = PLUGIN_STATES.map((s) => ({
		value: s,
		label: STATE_LABEL[s]
	}));

	const MEDALLION: Record<PluginState, string> = {
		failed: 'bg-danger/15 text-danger',
		running: 'bg-success/15 text-success',
		'not-enabled': 'bg-surface-2 text-muted',
		'not-started': 'bg-surface-2 text-muted',
		'not-built': 'bg-surface-2 text-faint'
	};

	let query = $state('');
	let category = $state('');
	let states = $state<string[]>([]);

	const filtered = $derived(filterRows(rows, { query, category, states }));
	const grouped = $derived(groupRows(filtered));

	// The failure count is the one number worth acting on, so it is a filter
	// rather than a sentence: a reader who sees it wants the rows, not the total.
	function showFailedOnly() {
		query = '';
		category = '';
		states = ['failed'];
	}
</script>

<PageTitle title="Plugins" />

{#snippet manageLicense()}
	<Button variant="secondary" size="sm" href="/admin/settings/license">
		<KeyRound size={ICON.sm} />
		Manage license
	</Button>
{/snippet}

<PageShell
	title="Plugins"
	description={summary}
	width="wide"
	actions={licensePage ? manageLicense : undefined}
>

	{#if data.error}
		<Alert tone="danger" title="Could not read the plugin status">
			{#snippet children()}
				{data.error} Every row comes from it, so no plugin is listed until the engine answers.
			{/snippet}
		</Alert>
	{/if}

	{#if failed > 0}
		<Alert tone="danger" title={failed === 1 ? 'One plugin failed to start' : `${failed} plugins failed to start`}>
			{#snippet children()}
				Each is part of this build and enabled, and did not come up, so the routes it serves are
				answering 404 right now.
				<Button variant="secondary" size="sm" onclick={showFailedOnly}>Show them</Button>
			{/snippet}
		</Alert>
	{/if}

	{#if rows.length === 0}
		{#if !data.error}
			<EmptyState
				title="No plugins in this build"
				description="This engine was built without plugins, so it serves only its own pages."
			>
				{#snippet iconSnippet()}<Puzzle size={ICON.lg} />{/snippet}
			</EmptyState>
		{/if}
	{:else}
		<ListToolbar label="Filter the plugins">
			{#snippet search()}
				<label for="plugin-search" class="sr-only">Search plugins</label>
				<SearchInput id="plugin-search" placeholder="Search plugins" bind:value={query} />
			{/snippet}
			{#snippet filters()}
				<label for="plugin-category" class="sr-only">Category</label>
				<Select
					id="plugin-category"
					options={categoryOptions}
					value={category}
					onvaluechange={(v) => (category = v)}
					class="w-44"
				/>
				<CheckboxGroup
					label="State"
					labelHidden
					orientation="horizontal"
					options={STATE_OPTIONS}
					bind:value={states}
				/>
			{/snippet}
		</ListToolbar>

		{#if filtered.length === 0}
			<EmptyState
				title="No plugins match your filters"
				description="Widen the search, choose a different category, or clear the state filter."
			>
				{#snippet iconSnippet()}<Filter size={ICON.lg} />{/snippet}
			</EmptyState>
		{:else}
			{#each grouped as [group, plugins] (group)}
				<section class="flex flex-col gap-4">
					<SectionHeading>{CATEGORY_LABEL[group]}</SectionHeading>
					<Card pad="none">
						<ul>
							{#each plugins as plugin (plugin.name)}
								{@render row(plugin)}
							{/each}
						</ul>
					</Card>
				</section>
			{/each}
		{/if}
	{/if}
</PageShell>

{#snippet row(plugin: PluginRow)}
	<li
		class="border-b border-line last:border-0"
		data-testid="plugin-row"
		data-plugin={plugin.name}
		data-state={plugin.state}
	>
		<a
			href="/admin/plugins/{encodeURIComponent(plugin.name)}"
			class="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2"
		>
			<span
				class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full {MEDALLION[plugin.state]}"
			>
				{#if plugin.state === 'failed'}
					<OctagonAlert size={ICON.sm} />
				{:else if plugin.state === 'running'}
					<Check size={ICON.sm} />
				{:else if plugin.state === 'not-enabled'}
					<Lock size={ICON.sm} />
				{:else if plugin.state === 'not-started'}
					<PowerOff size={ICON.sm} />
				{:else}
					<PackageX size={ICON.sm} />
				{/if}
			</span>

			<div class="min-w-0 flex-1">
				<div class="flex flex-wrap items-center gap-2">
					<span class="text-sm font-medium text-fg">{plugin.label}</span>
					{#if plugin.beta}
						<Badge tone="violet" size="sm">Beta</Badge>
					{/if}
				</div>
				{#if plugin.description}
					<p class="mt-0.5 truncate text-xs text-muted">{plugin.description}</p>
				{/if}
				{#if plugin.reason}
					<p class="mt-0.5 truncate text-xs {plugin.state === 'failed' ? 'text-danger' : 'text-faint'}">
						{plugin.reason}
					</p>
				{/if}
			</div>

			<div class="flex shrink-0 items-center gap-2">
				<Badge tone={STATE_TONE[plugin.state]}>{STATE_LABEL[plugin.state]}</Badge>
			</div>
		</a>
		{#if plugin.upgradeUrl}
			<div class="px-4 pb-3 ps-14">
				<a
					href={plugin.upgradeUrl}
					target={isExternalHref(plugin.upgradeUrl) ? '_blank' : undefined}
					rel={isExternalHref(plugin.upgradeUrl) ? 'noopener noreferrer' : undefined}
					class="inline-flex items-center gap-1 text-xs text-brand transition-colors hover:text-brand-light"
				>
					How to enable it
					{#if isExternalHref(plugin.upgradeUrl)}
						<ExternalLink size={ICON.xs} />
						<span class="sr-only">, opens in a new tab</span>
					{/if}
				</a>
			</div>
		{/if}
	</li>
{/snippet}
