<script lang="ts">
	import PageTitle from '$lib/components/PageTitle.svelte';
	import {
		Alert,
		Badge,
		Button,
		Card,
		EmptyState,
		Input,
		PageShell,
		PasswordInput,
		SearchInput,
		SectionHeading,
		SegmentedControl,
		Select,
		Table,
		confirm as confirmDialog,
		toast,
	} from '@lyeve-labs/ui-kit';
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { Activity, AlertTriangle, CheckCircle, Plus, RefreshCw, Send, Trash2, Upload } from '@lucide/svelte';
	import ListToolbar from '$lib/components/ListToolbar.svelte';
	import RefusalNotice from '$lib/components/RefusalNotice.svelte';
	import { formRefusal } from '$lib/api/refusal';
	import { tracked } from '$lib/forms.svelte';
	import {
		DESTINATION_KINDS,
		familiesMatching,
		formatMetricValue,
		labelText,
		sameOrigin,
		type DestinationKind,
	} from '$lib/api/telemetry';
	import { PLUGIN } from '$lib/plugin-names';
	import { rowFor } from '$lib/plugin-rows';
	import { NO_VALUE, formatDateTime } from '$lib/format';
	import type { ActionData, PageData } from './$types';
	import { ICON } from '$lib/icon';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// The plugin says whether it is beta, in the manifest the shell's status
	// report carries.
	const beta = $derived(rowFor(data.pluginStatus, PLUGIN.telemetry)?.beta === true);

	let refreshing = $state(false);
	async function refresh() {
		refreshing = true;
		try {
			await invalidateAll();
		} finally {
			refreshing = false;
		}
	}

	// The registry is filtered here, in the browser, because it is one read:
	// a super admin's whole registry is a few hundred families, and a tenant
	// admin's a handful, neither of which needs a round trip per keystroke.
	let query = $state('');
	let typeFilter = $state('all');

	const TYPE_OPTIONS = [
		{ value: 'all', label: 'Every type' },
		{ value: 'counter', label: 'Counters' },
		{ value: 'gauge', label: 'Gauges' },
		{ value: 'histogram', label: 'Histograms' },
		{ value: 'summary', label: 'Summaries' },
	];

	const families = $derived(data.families ?? []);
	const shown = $derived(
		familiesMatching(families, query).filter((f) => typeFilter === 'all' || f.type === typeFilter),
	);
	const sampleCount = $derived(families.reduce((n, f) => n + f.samples.length, 0));

	// A family's samples past this many are folded: a histogram with twelve
	// buckets per tenant is a wall, and the search is how a row is found.
	const SAMPLES_SHOWN = 12;
	let expanded = $state<Record<string, boolean>>({});

	let exporting = $state<string | null>(null);
	function exportNow(name: string) {
		return () => {
			exporting = name;
			return async ({ update }: { update: (opts?: { reset?: boolean }) => Promise<void> }) => {
				exporting = null;
				await update({ reset: false });
			};
		};
	}

	/**
	 * The row's name: a histogram's or summary's component series under its
	 * suffix, then the labels as the format writes them. A bare family with
	 * no labels reads as its own name rather than as an empty cell.
	 */
	function seriesText(familyName: string, labels: Record<string, string>): string {
		const base = labels.__series ? `${familyName}_${labels.__series}` : '';
		const text = `${base}${labelText(labels)}`;
		return text || familyName;
	}

	function exportedAt(e: { last_export?: string }): string {
		if (!e.last_export || e.last_export.startsWith('0001-')) return 'Never';
		return formatDateTime(e.last_export, NO_VALUE);
	}

	const refusal = $derived(formRefusal(form));
	const destinationError = $derived((form as { destinationError?: string } | null)?.destinationError ?? '');
	const hostMoved = $derived((form as { hostMoved?: boolean } | null)?.hostMoved === true);
	const destination = $derived(data.destination?.destination ?? null);

	let kind = $state<DestinationKind>('otlp');
	let destUrl = $state('');
	let headersMode = $state<'keep' | 'replace'>('keep');
	let headers = $state<{ id: number; name: string; value: string }[]>([]);
	let nextHeader = 0;

	// The form starts from what is stored, and follows a save or a removal.
	$effect(() => {
		kind = destination?.kind ?? 'otlp';
		destUrl = destination?.url ?? '';
		headersMode = destination && destination.header_names.length > 0 ? 'keep' : 'replace';
		headers = [];
	});

	// Leaving the stored headers in place while the host changes is the one
	// save the plugin refuses, so the form says so before it is sent.
	const movesHost = $derived(
		!!destination &&
			destination.header_names.length > 0 &&
			headersMode === 'keep' &&
			destUrl.trim() !== '' &&
			!sameOrigin(destination.url, destUrl.trim()),
	);

	function addHeader() {
		headers = [...headers, { id: nextHeader++, name: '', value: '' }];
	}

	function dropHeader(id: number) {
		headers = headers.filter((h) => h.id !== id);
	}

	const saveDest = tracked(() => async ({ result, update }) => {
		await update({ reset: false });
		if (result.type === 'success') toast.success('Saved the destination');
	});

	const removeDest: SubmitFunction = async ({ cancel }) => {
		const confirmed = await confirmDialog(
			'Remove the destination?',
			"This tenant's series stop being pushed there, and its stored headers are deleted.",
			{ confirmLabel: 'Delete' },
		);
		if (!confirmed) {
			cancel();
			return;
		}
		return async ({ result, update }) => {
			await update();
			if (result.type === 'success') toast.success('Removed the destination');
		};
	};
</script>

<PageTitle title="Telemetry" />

{#snippet noMetrics()}
	<Activity size={ICON.lg} />
{/snippet}

{#snippet noExporters()}
	<Send size={ICON.lg} />
{/snippet}

<PageShell
	title="Telemetry"
	description={data.superAdmin
		? "The engine's whole metrics registry, and the backends it is shipped to."
		: 'The request series recorded under this tenant.'}
	width="wide"
	back={{ href: '/admin/observability', label: 'Observability' }}
>
	{#snippet actions()}
		<Button variant="secondary" size="sm" onclick={refresh} loading={refreshing}>
			<RefreshCw size={ICON.sm} /> Refresh
		</Button>
	{/snippet}

	<div class="flex flex-wrap items-center gap-2">
		{#if beta}
			<Badge tone="violet" size="sm">Beta</Badge>
		{/if}
		<span class="text-xs text-muted">
			Histograms keep the engine's buckets, one exporter set serves the whole instance, and
			the tenant label is the tenant slug.
		</span>
	</div>

	<section class="flex flex-col gap-4" data-testid="telemetry-metrics">
		<div class="flex flex-wrap items-center gap-2">
			<SectionHeading level={2}>Metrics</SectionHeading>
			<span class="text-xs text-faint">
				{#if data.superAdmin}
					Whole registry: the process, the pool, every tenant's request series and the plugin's own.
				{:else}
					Only the series carrying your tenant label. Instance-wide series are the super admin's.
				{/if}
			</span>
		</div>

		<ListToolbar label="Filter the metrics">
			{#snippet search()}
				<SearchInput label="Filter families" placeholder="Family, help text or label value" bind:value={query} />
			{/snippet}
			{#snippet filters()}
				<span class="text-xs text-muted">{shown.length} of {families.length} families, {sampleCount} samples</span>
				<label for="metric-type" class="sr-only">Type</label>
				<Select id="metric-type" options={TYPE_OPTIONS} value={typeFilter} onvaluechange={(v) => { typeFilter = v; }} class="w-40" />
			{/snippet}
		</ListToolbar>

		{#if data.families === null}
			<EmptyState
				iconSnippet={noMetrics}
				title="Metrics unavailable"
				description="The telemetry plugin did not answer the scrape. It may not be in this build, or the registry is not initialized yet."
			/>
		{:else if families.length === 0}
			<EmptyState
				iconSnippet={noMetrics}
				title="No series yet"
				description={data.superAdmin
					? 'The registry is empty. Series appear once the engine has served a request.'
					: 'No request has been recorded under your tenant yet. Series appear once the API has served one.'}
			/>
		{:else if shown.length === 0}
			<EmptyState iconSnippet={noMetrics} title="No family matches" description="Nothing in the registry matches the filter." />
		{:else}
			<div class="flex flex-col gap-3" data-testid="metric-families">
				{#each shown as family (family.name)}
					{@const open = expanded[family.name] === true}
					{@const rows = open ? family.samples : family.samples.slice(0, SAMPLES_SHOWN)}
					<Card>
						{#snippet header()}
							<div class="flex flex-wrap items-center gap-2">
								<SectionHeading level={3}><span class="font-mono text-sm">{family.name}</span></SectionHeading>
								<Badge tone="neutral">{family.type}</Badge>
								<span class="ms-auto text-xs text-faint">{family.samples.length} samples</span>
							</div>
						{/snippet}
						{#if family.help}
							<p class="mb-3 text-xs text-muted">{family.help}</p>
						{/if}
						{#if family.samples.length === 0}
							<p class="text-sm text-muted">No sample in this family.</p>
						{:else}
							<Table label={family.name}>
								<thead>
									<tr>
										<th scope="col">Series</th>
										<th scope="col" class="text-right">Value</th>
									</tr>
								</thead>
								<tbody>
									{#each rows as sample, i (i)}
										<tr>
											<td class="font-mono text-xs">{seriesText(family.name, sample.labels)}</td>
											<td data-cell="nowrap" class="text-right font-mono text-xs">{formatMetricValue(sample.value)}</td>
										</tr>
									{/each}
								</tbody>
							</Table>
							{#if family.samples.length > SAMPLES_SHOWN}
								<div class="mt-2">
									<Button variant="ghost" size="sm" onclick={() => { expanded = { ...expanded, [family.name]: !open }; }}>
										{open ? 'Show fewer' : `Show all ${family.samples.length}`}
									</Button>
								</div>
							{/if}
						{/if}
					</Card>
				{/each}
			</div>
		{/if}
	</section>

	<section class="flex flex-col gap-4" data-testid="telemetry-destination" aria-label="Tenant destination">
		<div class="flex flex-wrap items-center gap-2">
			<SectionHeading level={2}>Tenant destination</SectionHeading>
			<span class="text-xs text-faint">
				Where this tenant's own series are pushed, beside the instance's exporters.
			</span>
		</div>

		{#if !data.destination}
			<Alert tone="danger">The destination could not be read. This is not a report that none is set.</Alert>
		{:else}
			{#if refusal}
				<RefusalNotice {refusal} />
			{:else if hostMoved}
				<Alert tone="warn" title="Send the headers again for the new host">
					<p>
						The stored headers usually carry the collector's key, so they are never carried to a different host.
						Choose to replace the headers and enter them for the new address. Nothing was saved.
					</p>
				</Alert>
			{:else if destinationError}
				<Alert tone="danger">{destinationError}</Alert>
			{/if}

			{#if !data.destination.licensed}
				<p class="text-sm text-muted">
					Setting or changing a destination needs a license this install does not hold. A destination already
					saved keeps receiving, and removing it is always allowed.
				</p>
			{/if}

			{#if destination?.health}
				<p class="flex flex-wrap items-center gap-2 text-xs text-muted">
					{#if destination.health.healthy}
						<Badge tone="success"><CheckCircle size={ICON.xs} /> Healthy</Badge>
					{:else}
						<Badge tone="danger"><AlertTriangle size={ICON.xs} /> Failing</Badge>
					{/if}
					Last push {exportedAt(destination.health)}, {destination.health.exports} pushed, {destination.health.failures}
					failed.
					{#if destination.health.last_error}
						<span class="font-mono">{destination.health.last_error}</span>
					{/if}
				</p>
			{/if}

			<Card pad="md">
				<form
					id="destination-form"
					method="POST"
					action="?/saveDestination"
					use:enhance={saveDest.enhance}
					class="flex flex-col gap-4"
				>
					<SegmentedControl label="Protocol" name="kind" bind:value={kind} options={[...DESTINATION_KINDS]} />
					<Input
						id="destination-url"
						name="url"
						label="URL"
						placeholder="https://otlp.example.com/v1/metrics"
						hint="An http or https address. Credentials go in a header, never in the URL."
						bind:value={destUrl}
						required
					/>

					{#if destination && destination.header_names.length > 0}
						<SegmentedControl
							label="Headers"
							name="headers_mode"
							bind:value={headersMode}
							options={[
								{ value: 'keep', label: 'Keep the stored headers' },
								{ value: 'replace', label: 'Replace them' },
							]}
						/>
						{#if headersMode === 'keep'}
							<p class="text-xs text-muted">
								Stored: <span class="font-mono">{destination.header_names.join(', ')}</span>. Their values are
								never shown.
							</p>
						{/if}
					{:else}
						<input type="hidden" name="headers_mode" value="replace" />
					{/if}

					{#if movesHost}
						<Alert tone="warn">
							This URL is on another host than the stored one, so the stored headers will not follow it. Replace
							the headers to save.
						</Alert>
					{/if}

					{#if headersMode === 'replace'}
						<div class="flex flex-col gap-3">
							{#each headers as h (h.id)}
								<div class="grid items-end gap-2 sm:grid-cols-[1fr_1fr_auto]">
									<Input id="header-name-{h.id}" name="header_name" label="Header" placeholder="Authorization" bind:value={h.name} />
									<PasswordInput
										id="header-value-{h.id}"
										name="header_value"
										label="Value"
										autocomplete="off"
										bind:value={h.value}
									/>
									<Button variant="ghost" size="sm" aria-label="Remove header {h.name || h.id}" onclick={() => dropHeader(h.id)}>
										<Trash2 size={ICON.sm} class="text-danger" />
									</Button>
								</div>
							{/each}
							<div>
								<Button variant="secondary" size="sm" onclick={addHeader}>
									<Plus size={ICON.sm} /> Add header
								</Button>
							</div>
							{#if destination && destination.header_names.length > 0 && headers.length === 0}
								<p class="text-xs text-muted">Saving with no header clears the stored ones.</p>
							{/if}
						</div>
					{/if}

					<div class="flex flex-wrap gap-2">
						<Button variant="primary" type="submit" loading={saveDest.pending}>Save</Button>
					</div>
				</form>
				{#if destination}
					<form method="POST" action="?/removeDestination" class="mt-4 border-t border-line pt-4" use:enhance={removeDest}>
						<Button variant="secondary" size="sm" type="submit">Remove destination</Button>
					</form>
				{/if}
			</Card>
		{/if}
	</section>

	{#if data.superAdmin}
		<!-- The exporters are the instance's export configuration, which no tenant
		     owns, so a tenant admin's page has no such section rather than an
		     empty one. -->
		<section class="flex flex-col gap-4" data-testid="telemetry-exporters">
			<div class="flex flex-wrap items-center gap-2">
				<SectionHeading level={2}>Exporters</SectionHeading>
				<span class="text-xs text-faint">
					Configured through the plugin's metrics_* settings. The scheduled loop runs when the engine enables it, and the manual export runs on demand.
				</span>
			</div>

			{#if form?.error}
				<Alert tone="warn">{form.error}</Alert>
			{:else if form?.exported}
				<Alert tone="success" autoDismiss>{form.message}</Alert>
			{/if}

			{#if data.exporters === null}
				<EmptyState
					iconSnippet={noExporters}
					title="Exporters unavailable"
					description="The telemetry plugin did not answer with its exporter list."
				/>
			{:else if data.exporters.length === 0}
				<EmptyState
					iconSnippet={noExporters}
					title="No exporter configured"
					description="Set a Pushgateway URL, an OTLP endpoint, a StatsD address or a New Relic key in the plugin's settings and restart the engine."
				/>
			{:else}
				<Table label="Exporters">
					<thead>
						<tr>
							<th scope="col">Exporter</th>
							<th scope="col">State</th>
							<th scope="col">Last export</th>
							<th scope="col" class="text-right">Exports</th>
							<th scope="col" class="text-right">Failures</th>
							<th scope="col">Last error</th>
							<th scope="col" class="w-12"><span class="sr-only">Export now</span></th>
						</tr>
					</thead>
					<tbody>
						{#each data.exporters as exporter (exporter.name)}
							<tr>
								<td data-cell="nowrap" class="font-mono text-xs">{exporter.name}</td>
								<td>
									{#if exporter.healthy}
										<Badge tone="success"><CheckCircle size={ICON.xs} /> Healthy</Badge>
									{:else}
										<Badge tone="danger"><AlertTriangle size={ICON.xs} /> Unhealthy</Badge>
									{/if}
								</td>
								<td data-cell="nowrap" class="text-xs">{exportedAt(exporter)}</td>
								<td data-cell="nowrap" class="text-right font-mono text-xs">{exporter.exports}</td>
								<td data-cell="nowrap" class="text-right font-mono text-xs">{exporter.failures}</td>
								<td class="text-xs text-muted">{exporter.last_error || NO_VALUE}</td>
								<td>
									<form method="POST" action="?/export" use:enhance={exportNow(exporter.name)}>
										<input type="hidden" name="name" value={exporter.name} />
										<Button type="submit" variant="ghost" size="sm" aria-label="Export {exporter.name} now" loading={exporting === exporter.name}>
											<Upload size={ICON.sm} />
										</Button>
									</form>
								</td>
							</tr>
						{/each}
					</tbody>
				</Table>
			{/if}
		</section>
	{/if}
</PageShell>
