<script lang="ts">
	import PageTitle from '$lib/components/PageTitle.svelte';
	import {
		Alert,
		Badge,
		Button,
		Card,
		EmptyState,
		Input,
		NumberInput,
		PageShell,
		SectionHeading,
		Stat,
		Table,
		confirm as confirmDialog,
	} from '@lyeve-labs/ui-kit';
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import {
		AlertTriangle,
		CheckCircle,
		Download,
		Flame,
		Gauge,
		MemoryStick,
		Puzzle,
		RefreshCw,
		RotateCcw,
	} from '@lucide/svelte';
	import {
		PROFILE_SECONDS,
		PROFILE_TYPES,
		formatBytes,
		formatNs,
		latencyTone,
		type EndpointStats,
	} from '$lib/api/profiler';
	import { NO_VALUE, formatDateTime, formatTime } from '$lib/format';
	import type { ActionData, PageData } from './$types';
	import { ICON } from '$lib/icon';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let refreshing = $state(false);
	async function refresh() {
		refreshing = true;
		try {
			await invalidateAll();
		} finally {
			refreshing = false;
		}
	}

	let resetting = $state(false);
	let capturing = $state(false);
	let flameEndpoint = $state('');
	let flameSeconds = $state<number>(PROFILE_SECONDS.default);
	let cpuSeconds = $state<number>(PROFILE_SECONDS.default);

	const memory = $derived(data.memory);
	const latest = $derived(memory?.snapshots.at(-1) ?? null);

	// The flamegraph is the last action's answer while the page holds it. It
	// is drawn as an image from a data URL rather than inlined as markup: the
	// SVG comes from the engine's pprof renderer, and an image cannot run the
	// script such a file may carry.
	const graph = $derived(form?.form === 'flamegraph' && 'graph' in form ? form.graph : null);
	const graphSrc = $derived(graph ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(graph.svg)}` : null);

	function detailHref(endpoint: string): string {
		return `/admin/observability/profiler?endpoint=${encodeURIComponent(endpoint.replace(/^\/+/, ''))}`;
	}

	const PROFILE_LABELS: Record<(typeof PROFILE_TYPES)[number], string> = {
		cpu: 'CPU',
		goroutine: 'Goroutines',
		heap: 'Heap',
		allocs: 'Allocations',
	};
</script>

<PageTitle title="Profiler" />

{#snippet noEndpoints()}
	<Gauge size={ICON.lg} />
{/snippet}

{#snippet noPlugins()}
	<Puzzle size={ICON.lg} />
{/snippet}

{#snippet noMemory()}
	<MemoryStick size={ICON.lg} />
{/snippet}

{#snippet endpointRows(rows: EndpointStats[], label: string)}
	<Table {label}>
		<thead>
			<tr>
				<th scope="col">Method</th>
				<th scope="col">Path</th>
				<th scope="col" class="text-right">Count</th>
				<th scope="col" class="text-right">Avg</th>
				<th scope="col" class="text-right">P50</th>
				<th scope="col" class="text-right">P95</th>
				<th scope="col" class="text-right">P99</th>
				<th scope="col" class="text-right">Max</th>
				<th scope="col" class="text-right">Avg alloc</th>
			</tr>
		</thead>
		<tbody>
			{#each rows as row (`${row.method} ${row.endpoint}`)}
				<tr>
					<td><Badge tone="neutral">{row.method}</Badge></td>
					<td data-cell="nowrap" class="font-mono text-xs">
						<a href={detailHref(row.endpoint)} class="text-fg underline-offset-2 transition-colors hover:text-brand hover:underline">{row.endpoint}</a>
					</td>
					<td data-cell="nowrap" class="text-right text-xs"><span class="text-faint">{row.count}</span></td>
					<td data-cell="nowrap" class="text-right font-mono text-xs">{formatNs(row.avg_duration_ns)}</td>
					<td data-cell="nowrap" class="text-right font-mono text-xs">{formatNs(row.p50_duration_ns)}</td>
					<td class="text-right"><Badge tone={latencyTone(row.p95_duration_ns)}>{formatNs(row.p95_duration_ns)}</Badge></td>
					<td data-cell="nowrap" class="text-right font-mono text-xs">{formatNs(row.p99_duration_ns)}</td>
					<td data-cell="nowrap" class="text-right font-mono text-xs">{formatNs(row.max_duration_ns)}</td>
					<td data-cell="nowrap" class="text-right font-mono text-xs">{formatBytes(row.avg_alloc_bytes)}</td>
				</tr>
			{/each}
		</tbody>
	</Table>
{/snippet}

<PageShell
	title="Profiler"
	description="Per-endpoint and per-plugin timings from the engine's request sampler, the memory trend, pprof exports and flamegraphs."
	width="wide"
	back={{ href: '/admin/observability', label: 'Observability' }}
>
	{#snippet actions()}
		<Button variant="secondary" size="sm" onclick={refresh} loading={refreshing}>
			<RefreshCw size={ICON.sm} /> Refresh
		</Button>
		<form
			method="POST"
			action="?/reset"
			use:enhance={async ({ cancel }) => {
				const confirmed = await confirmDialog(
					'Reset the profiler?',
					'The sampled requests and the memory snapshots are dropped and a fresh snapshot is taken.',
					{ confirmLabel: 'Reset' },
				);
				if (!confirmed) {
					cancel();
					return;
				}
				resetting = true;
				return async ({ update }) => {
					resetting = false;
					await update({ reset: false });
				};
			}}
		>
			<Button type="submit" variant="secondary" size="sm" loading={resetting}>
				<RotateCcw size={ICON.sm} /> Reset
			</Button>
		</form>
	{/snippet}

	{#if form?.form === 'reset'}
		{#if 'error' in form && form.error}
			<Alert tone="danger">{form.error}</Alert>
		{:else}
			<Alert tone="success" autoDismiss>The profiler was reset.</Alert>
		{/if}
	{/if}

	<section class="flex flex-col gap-4" data-testid="profiler-memory">
		<div class="flex flex-wrap items-center gap-2">
			<SectionHeading level={2}>Memory</SectionHeading>
			{#if memory}
				{#if memory.leak_likely}
					<Badge tone="danger"><AlertTriangle size={ICON.xs} /> Leak likely</Badge>
				{:else}
					<Badge tone="success"><CheckCircle size={ICON.xs} /> Steady</Badge>
				{/if}
				<span class="ms-auto text-xs text-faint">{memory.snapshots.length} snapshots</span>
			{/if}
		</div>
		{#if !memory}
			<EmptyState iconSnippet={noMemory} title="Memory trend unavailable" description="The engine did not answer with its memory snapshots." />
		{:else if !latest}
			<EmptyState iconSnippet={noMemory} title="No snapshot yet" description="The sampler takes a snapshot on a schedule. The first one has not been taken." />
		{:else}
			<Card>
				<div class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6" data-testid="memory-stats">
					<Stat size="sm" label="Heap in use" mono value={formatBytes(latest.heap_alloc)} />
					<Stat size="sm" label="Heap objects" mono value={latest.heap_objects} />
					<Stat size="sm" label="Allocated total" mono value={formatBytes(latest.total_alloc)} />
					<Stat size="sm" label="GC cycles" mono value={latest.num_gc} />
					<Stat size="sm" label="Goroutines" mono value={latest.num_goroutine} />
					<Stat size="sm" label="Heap slope" mono value="{formatBytes(memory.slope_bytes_per_sec)}/s" tone={memory.leak_likely ? 'danger' : undefined} />
				</div>
				<p class="mt-3 text-xs text-muted">
					Last snapshot {formatDateTime(latest.timestamp, NO_VALUE)}.
					{#if memory.leak_reason}{memory.leak_reason}{/if}
				</p>
			</Card>
		{/if}
	</section>

	<section class="flex flex-col gap-4" data-testid="profiler-slowest">
		<div class="flex flex-wrap items-center gap-2">
			<SectionHeading level={2}>Slowest endpoints</SectionHeading>
			<span class="text-xs text-faint">By p95, the twenty slowest. {data.endpoints?.length ?? 0} endpoints sampled.</span>
		</div>
		{#if !data.slowest}
			<EmptyState iconSnippet={noEndpoints} title="Profiler unavailable" description="The engine did not answer with its endpoint statistics." />
		{:else if data.slowest.length === 0}
			<EmptyState iconSnippet={noEndpoints} title="Nothing sampled yet" description="Endpoints appear here once the sampler has timed some requests." />
		{:else}
			{@render endpointRows(data.slowest, 'Slowest endpoints')}
		{/if}
	</section>

	{#if data.selected}
		<section class="flex flex-col gap-4" data-testid="profiler-detail">
			<div class="flex flex-wrap items-center gap-2">
				<SectionHeading level={2}><span class="font-mono">{data.selected}</span></SectionHeading>
				{#if data.detail}
					<span class="text-xs text-faint">{data.detail.total_count} entries in the ring</span>
				{/if}
				<a href="/admin/observability/profiler" class="ms-auto text-xs text-muted underline-offset-2 transition-colors hover:text-fg hover:underline">Clear selection</a>
			</div>
			{#if !data.detail}
				<EmptyState iconSnippet={noEndpoints} title="No data for this endpoint" description="The ring holds no sample for it. It may have been reset, or the path is not one the engine served." />
			{:else}
				{@render endpointRows(data.detail.methods.map((m) => m.stats), `Methods for ${data.selected}`)}
				{#each data.detail.methods as method (method.method)}
					<Card>
						{#snippet header()}
							<div class="flex flex-wrap items-center gap-2">
								<SectionHeading level={3}>Recent {method.method} requests</SectionHeading>
								<span class="ms-auto text-xs text-faint">{method.recent_entries.length} of {method.count}</span>
							</div>
						{/snippet}
						<Table label="Recent {method.method} requests">
							<thead>
								<tr>
									<th scope="col">Captured</th>
									<th scope="col" class="text-right">Status</th>
									<th scope="col" class="text-right">Duration</th>
									<th scope="col" class="text-right">Alloc</th>
									<th scope="col" class="text-right">Goroutines</th>
									<th scope="col">Plugin</th>
								</tr>
							</thead>
							<tbody>
								{#each method.recent_entries as e, i (i)}
									<tr>
										<td data-cell="nowrap" class="font-mono text-xs"><span class="text-faint">{formatTime(e.captured_at, e.captured_at)}</span></td>
										<td class="text-right"><Badge tone={e.status_code >= 500 ? 'danger' : e.status_code >= 400 ? 'warn' : 'neutral'}>{e.status_code}</Badge></td>
										<td data-cell="nowrap" class="text-right font-mono text-xs">{formatNs(e.duration_ns)}</td>
										<td data-cell="nowrap" class="text-right font-mono text-xs">{formatBytes(e.alloc_bytes)}</td>
										<td data-cell="nowrap" class="text-right font-mono text-xs">{e.num_goroutine}</td>
										<td data-cell="nowrap" class="text-xs">{e.plugin || NO_VALUE}</td>
									</tr>
								{/each}
							</tbody>
						</Table>
					</Card>
				{/each}
			{/if}
		</section>
	{/if}

	<section class="flex flex-col gap-4" data-testid="profiler-plugins">
		<div class="flex flex-wrap items-center gap-2">
			<SectionHeading level={2}>By plugin</SectionHeading>
		</div>
		{#if !data.plugins}
			<EmptyState iconSnippet={noPlugins} title="Plugin breakdown unavailable" description="The engine did not answer with its per-plugin statistics." />
		{:else if data.plugins.length === 0}
			<EmptyState iconSnippet={noPlugins} title="Nothing sampled yet" description="Plugins appear here once a request has been served through one." />
		{:else}
			<Table label="By plugin">
				<thead>
					<tr>
						<th scope="col">Plugin</th>
						<th scope="col" class="text-right">Count</th>
						<th scope="col" class="text-right">Avg</th>
						<th scope="col" class="text-right">Max</th>
						<th scope="col" class="text-right">Allocated</th>
					</tr>
				</thead>
				<tbody>
					{#each data.plugins as p (p.plugin)}
						<tr>
							<td data-cell="nowrap" class="font-mono text-xs">{p.plugin}</td>
							<td data-cell="nowrap" class="text-right text-xs"><span class="text-faint">{p.count}</span></td>
							<td data-cell="nowrap" class="text-right font-mono text-xs">{formatNs(p.avg_duration_ns)}</td>
							<td data-cell="nowrap" class="text-right font-mono text-xs">{formatNs(p.max_duration_ns)}</td>
							<td data-cell="nowrap" class="text-right font-mono text-xs">{formatBytes(p.total_alloc_bytes)}</td>
						</tr>
					{/each}
				</tbody>
			</Table>
		{/if}
	</section>

	<div class="grid gap-4 lg:grid-cols-2">
		<!-- A pprof export is a file. The form posts without enhancement so the
		     browser takes the engine's attachment as a download. -->
		<Card>
			{#snippet header()}
				<div class="flex flex-wrap items-center gap-2">
					<SectionHeading level={3}>pprof export</SectionHeading>
				</div>
			{/snippet}
			<div class="flex flex-col gap-4" data-testid="profiler-exports">
				<p class="text-xs text-muted">
					Each download is a gzipped pprof profile. A heap or allocations profile carries raw
					process memory and is logged when exported. An instance may refuse those two.
				</p>
				<NumberInput
					id="cpu-seconds"
					name="cpu_seconds"
					label="CPU window"
					hint="Seconds the CPU profile samples, {PROFILE_SECONDS.min} to {PROFILE_SECONDS.max}."
					min={PROFILE_SECONDS.min}
					max={PROFILE_SECONDS.max}
					bind:value={cpuSeconds}
				/>
				<div class="flex flex-wrap gap-2">
					{#each PROFILE_TYPES as type (type)}
						<form method="POST" action="/api/admin/debug/profiler/profile/{type}">
							{#if type === 'cpu'}
								<input type="hidden" name="duration_sec" value={cpuSeconds} />
							{/if}
							<Button type="submit" variant="secondary" size="sm">
								<Download size={ICON.sm} /> {PROFILE_LABELS[type]}
							</Button>
						</form>
					{/each}
				</div>
			</div>
		</Card>

		<Card>
			{#snippet header()}
				<div class="flex flex-wrap items-center gap-2">
					<SectionHeading level={3}>Flamegraph</SectionHeading>
				</div>
			{/snippet}
			<form
				method="POST"
				action="?/flamegraph"
				class="flex flex-col gap-4"
				aria-label="Capture a flamegraph"
				use:enhance={() => {
					capturing = true;
					return async ({ update }) => {
						capturing = false;
						await update({ reset: false });
					};
				}}
			>
				<p class="text-xs text-muted">
					A CPU profile over the window, rendered as a graph. The endpoint is a label on the
					result: the profile covers every goroutine in the process.
				</p>
				<Input
					id="flame-endpoint"
					name="endpoint"
					label="Endpoint"
					placeholder="/api/v1/content"
					bind:value={flameEndpoint}
					autocomplete="off"
					mono
				/>
				<NumberInput
					id="flame-seconds"
					name="duration_sec"
					label="Window"
					hint="Seconds, {PROFILE_SECONDS.min} to {PROFILE_SECONDS.max}."
					min={PROFILE_SECONDS.min}
					max={PROFILE_SECONDS.max}
					bind:value={flameSeconds}
				/>
				<div>
					<Button type="submit" variant="primary" size="sm" loading={capturing}>
						<Flame size={ICON.sm} /> Capture
					</Button>
				</div>
				{#if form?.form === 'flamegraph' && 'error' in form && form.error}
					<Alert tone="danger">{form.error}</Alert>
				{/if}
			</form>
		</Card>
	</div>

	{#if graph && graphSrc}
		<Card>
			{#snippet header()}
				<div class="flex flex-wrap items-center gap-2">
					<SectionHeading level={3}><span class="font-mono">{graph.endpoint}</span></SectionHeading>
					<span class="ms-auto text-xs text-faint">{graph.duration_sec}s CPU, captured {formatDateTime(graph.captured_at, NO_VALUE)}</span>
				</div>
			{/snippet}
			<div class="overflow-x-auto" data-testid="flamegraph">
				<img src={graphSrc} alt="CPU flamegraph for {graph.endpoint}" class="max-w-none" />
			</div>
		</Card>
	{/if}
</PageShell>
