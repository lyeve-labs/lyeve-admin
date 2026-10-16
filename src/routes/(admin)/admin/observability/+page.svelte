<script lang="ts">
	import { Alert, Badge, Button, Card, EmptyState, PageShell, SectionHeading, SegmentedControl, Stat, Table, type StatusTone } from '@lyeve-labs/ui-kit';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import { invalidateAll } from '$app/navigation';
	import { Database, Gauge, AlertTriangle, CheckCircle, RefreshCw } from '@lucide/svelte';
	import ListToolbar from '$lib/components/ListToolbar.svelte';
	import { LATENCY_TOP_CHOICES } from '$lib/api/observability';
	import { NO_VALUE } from '$lib/format';
	import type { ActionData, PageData } from './$types';
	import { ICON } from '$lib/icon';
	import GoroutineEnginePanel from './GoroutineEnginePanel.svelte';
	import LiveLogTail from './LiveLogTail.svelte';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// Both panels read through the page load, so a refresh is one invalidation
	// and the row count survives a reload as a query parameter. Fetching from
	// the component would leave the server render and the client holding two
	// different answers with nothing reconciling them.
	let refreshing = $state(false);

	async function refresh() {
		refreshing = true;
		try {
			await invalidateAll();
		} finally {
			refreshing = false;
		}
	}

	// Each depth is a link, so the ranking a person is looking at is an
	// address and the choice works before the page hydrates.
	const topOptions = LATENCY_TOP_CHOICES.map((c) => ({
		value: String(c),
		label: `Top ${c}`,
		href: `/admin/observability?top=${c}`,
	}));

	function fmtUs(us: number): string {
		if (us >= 1_000_000) return `${(us / 1_000_000).toFixed(2)}s`;
		if (us >= 1_000) return `${(us / 1_000).toFixed(1)}ms`;
		return `${us}µs`;
	}

	function latencyVariant(us: number): StatusTone {
		if (us >= 1_000_000) return 'danger';
		if (us >= 100_000) return 'warn';
		if (us <= 10_000) return 'success';
		return 'neutral';
	}

	// The engine measures its pool on every read and sends the counts at the top
	// level of its answer. An engine with no pool health provider wired sends
	// none, so their absence is a deployment fact rather than a measurement.
	const pool = $derived(data.poolHealth.ok ? data.poolHealth.value : null);
	const measured = $derived(typeof pool?.open_connections === 'number');
</script>

{#snippet noPoolHealth()}
	<Database size={ICON.lg} />
{/snippet}

{#snippet noLatency()}
	<Gauge size={ICON.lg} />
{/snippet}

<PageShell
	title="Observability"
	description="Pool health, goroutines and the engine's own instrumentation."
	width="wide"
>
	{#snippet actions()}
		<!-- One refresh for the page: both panels read through the load, so one
		     invalidation refreshes them together. -->
		<Button variant="secondary" size="sm" onclick={refresh} loading={refreshing}>
			<RefreshCw size={ICON.sm} /> Refresh
		</Button>
	{/snippet}

	<!-- The pool's state is a badge on its card, not a banner over the page:
	     an engine with no pool health provider answers this way every time, and a warning
	     that greets every visit stops being read. The figures are one row. -->
	<Card>
		{#snippet header()}
			<div class="flex flex-wrap items-center gap-2">
				<SectionHeading level={2}>Connection pool</SectionHeading>
				{#if pool?.engine}
					{#if !pool.healthy}
						<Badge tone="danger" class="shrink-0 whitespace-nowrap"><AlertTriangle size={ICON.xs} /> Unhealthy</Badge>
					{:else if measured}
						<Badge tone="success" class="shrink-0 whitespace-nowrap"><CheckCircle size={ICON.xs} /> Healthy</Badge>
					{/if}
				{/if}
			</div>
		{/snippet}

		{#if !data.poolHealth.ok}
			<GateNotice
				gate={data.poolHealth.gate}
				title="the pool health"
				absent="This engine does not report pool health."
			/>
		{:else if pool?.engine}
			<div class="grid grid-cols-2 gap-4 sm:grid-cols-4 xl:grid-cols-7" data-testid="pool-stats">
				<Stat size="sm" label="Engine" value={pool.engine} />
				<Stat
					size="sm"
					label="Ping latency"
					mono
					value={typeof pool.latency_ms === 'number' ? fmtUs(Math.round(pool.latency_ms * 1000)) : NO_VALUE}
				/>
				<Stat size="sm" label="Goroutines" mono value={data.goroutines ?? NO_VALUE} />
				{#if measured}
					<Stat size="sm" label="Open" mono value={pool.open_connections ?? NO_VALUE} />
					<Stat size="sm" label="In use" mono value={pool.in_use ?? NO_VALUE} />
					<Stat size="sm" label="Idle" mono value={pool.idle ?? NO_VALUE} />
					<Stat size="sm" label="Wait count" mono value={pool.wait_count ?? NO_VALUE} />
				{/if}
			</div>
			{#if pool.errors && pool.errors.length > 0}
				<div class="mt-3">
					<Alert tone="danger" title="Pool reported errors">
						<ul class="flex flex-col gap-1">
							{#each pool.errors as err (err)}
								<li>{err}</li>
							{/each}
						</ul>
					</Alert>
				</div>
			{/if}
		{:else}
			<EmptyState
				iconSnippet={noPoolHealth}
				title="Pool health unavailable"
				description="The engine did not answer with pool statistics. The pooler may not be configured on this deployment."
			/>
		{/if}
	</Card>

	<GoroutineEnginePanel engine={data.goroutineEngine} {form} />

	<section class="flex flex-col gap-4">
		<div class="flex items-center gap-2">
			<SectionHeading level={2}>Latency rankings</SectionHeading>
		</div>

		<ListToolbar label="Latency rankings">
			{#snippet search()}
				{#if data.latency.ok}
					<span class="text-xs text-muted">{data.latency.value.total} endpoints tracked</span>
				{/if}
			{/snippet}
			{#snippet filters()}
				<!-- A depth is a page address. It replaces the entry in the history
				     and keeps the reader where they were on the page. -->
				<div id="latency-top" data-sveltekit-noscroll data-sveltekit-replacestate>
					<SegmentedControl label="Rows" labelHidden size="sm" options={topOptions} value={String(data.top)} />
				</div>
			{/snippet}
		</ListToolbar>

		{#if !data.latency.ok}
			<GateNotice
				gate={data.latency.gate}
				title="the latency rankings"
				absent="This engine does not time its endpoints."
			/>
		{:else if data.latency.value.slowest.length === 0}
			<EmptyState
				iconSnippet={noLatency}
				title="No latency data yet"
				description="Endpoints appear here once the engine has timed some requests."
			/>
		{:else}
			<Table label="Latency rankings">
				<thead>
					<tr>
						<th scope="col" class="w-8">#</th>
						<th scope="col">Method</th>
						<th scope="col">Path</th>
						<th scope="col" class="text-right">Count</th>
						<th scope="col" class="text-right">Min</th>
						<th scope="col" class="text-right">Avg</th>
						<th scope="col" class="text-right">P50</th>
						<th scope="col" class="text-right">P95</th>
						<th scope="col" class="text-right">P99</th>
						<th scope="col" class="text-right">Max</th>
					</tr>
				</thead>
				<tbody>
					{#each data.latency.value.slowest as entry, i (`${entry.method} ${entry.path}`)}
						<tr>
							<td data-cell="nowrap"><span class="text-faint">{i + 1}</span></td>
							<td><Badge tone="neutral">{entry.method}</Badge></td>
							<td data-cell="nowrap" class="font-mono text-xs">{entry.path}</td>
							<td data-cell="nowrap" class="text-right text-xs"><span class="text-faint">{entry.count}</span></td>
							<td data-cell="nowrap" class="text-right font-mono text-xs">{fmtUs(entry.min_us)}</td>
							<td data-cell="nowrap" class="text-right font-mono text-xs">{fmtUs(entry.avg_us)}</td>
							<td data-cell="nowrap" class="text-right font-mono text-xs">{fmtUs(entry.p50_us)}</td>
							<td class="text-right">
								<Badge tone={latencyVariant(entry.p95_us)}>{fmtUs(entry.p95_us)}</Badge>
							</td>
							<td data-cell="nowrap" class="text-right font-mono text-xs">{fmtUs(entry.p99_us)}</td>
							<td data-cell="nowrap" class="text-right font-mono text-xs">{fmtUs(entry.max_us)}</td>
						</tr>
					{/each}
				</tbody>
			</Table>
		{/if}
	</section>

	<LiveLogTail running={data.logTail} />
</PageShell>
