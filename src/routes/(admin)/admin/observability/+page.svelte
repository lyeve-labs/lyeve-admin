<script lang="ts">
	import PageTitle from '$lib/components/PageTitle.svelte';
	import {
		Alert,
		Badge,
		Button,
		Card,
		Checkbox,
		EmptyState,
		Input,
		NumberInput,
		PageShell,
		SectionHeading,
		Select,
		Stat,
		Table,
	} from '@lyeve-labs/ui-kit';
	import { onMount } from 'svelte';
	import { enhance } from '$app/forms';
	import { goto, invalidateAll } from '$app/navigation';
	import {
		Activity,
		Cpu,
		Database,
		Gauge,
		AlertTriangle,
		CheckCircle,
		RefreshCw,
		Trash2,
	} from '@lucide/svelte';
	import ListToolbar from '$lib/components/ListToolbar.svelte';
	import {
		ASYNC_QUEUE_SIZE,
		ASYNC_TIMEOUT_MAX,
		ASYNC_WORKERS,
		PARALLEL_MAX_CONCURRENT,
		PARALLEL_TIMEOUT_MAX,
		POOL_SIZE,
	} from '$lib/api/goroutine-engine';
	import { LATENCY_TOP_CHOICES } from '$lib/api/observability';
	import { LICENSE_PAGE, formRefusal } from '$lib/api/refusal';
	import RefusalNotice from '$lib/components/RefusalNotice.svelte';
	import {
		LOG_LEVELS,
		NO_VALUE,
		formatDateTime,
		formatGoDuration,
		formatTime,
		logLevelLabel,
		logLevelTone,
	} from '$lib/format';
	import type { ActionData, PageData } from './$types';
	import type { TunableForm } from './+page.server';
	import { ICON } from '$lib/icon';

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

	function setLatencyTop(top: string) {
		void goto(`/admin/observability?top=${top}`, {
			replaceState: true,
			keepFocus: true,
			noScroll: true,
			invalidateAll: true,
		});
	}

	function fmtUs(us: number): string {
		if (us >= 1_000_000) return `${(us / 1_000_000).toFixed(2)}s`;
		if (us >= 1_000) return `${(us / 1_000).toFixed(1)}ms`;
		return `${us}µs`;
	}

	function latencyVariant(us: number): 'danger' | 'warn' | 'success' | 'neutral' {
		if (us >= 1_000_000) return 'danger';
		if (us >= 100_000) return 'warn';
		if (us <= 10_000) return 'success';
		return 'neutral';
	}

	// The engine sends the counts only where a pooler is configured, so their
	// absence is a deployment fact rather than a fetch that went wrong.
	const poolStats = $derived(data.poolHealth.pool_stats);

	const ge = $derived(data.goroutineEngine);
	const geAnswered = $derived(Boolean(ge.snapshot || ge.pool || ge.parallel || ge.asyncHooks));
	// The writes need super_admin and a license that lets tuning through. A
	// form that could only ever answer 403 or 402 is shown disabled with the
	// reason. The tiles above it are reads and stay either way.
	const canTune = $derived(ge.superAdmin && ge.licensed);

	// The forms open on the live values and send them all back, so a field
	// the operator did not touch is saved as it was. They are seeded once:
	// a refresh must not overwrite an edit in progress.
	// svelte-ignore state_referenced_locally
	const seed = data.goroutineEngine;
	let poolSize = $state(seed.pool?.size ?? POOL_SIZE.min);
	let parallelMax = $state(seed.parallel?.max_concurrent ?? PARALLEL_MAX_CONCURRENT.min);
	let parallelTimeout = $state(seed.parallel?.timeout ?? '30s');
	let asyncWorkers = $state(seed.asyncHooks?.workers ?? ASYNC_WORKERS.min);
	let asyncQueue = $state(seed.asyncHooks?.queue_size ?? ASYNC_QUEUE_SIZE.min);
	let asyncTimeout = $state(seed.asyncHooks?.timeout ?? '5s');
	let asyncEnabled = $state(seed.asyncHooks?.enabled ?? false);
	let saving = $state<TunableForm | null>(null);

	/** The last action's answer, only for the form that asked. */
	function tunableNote(which: TunableForm) {
		return form?.form === which ? form : null;
	}

	function tunable(which: TunableForm) {
		return () => {
			saving = which;
			return async ({ update }: { update: (opts?: { reset?: boolean }) => Promise<void> }) => {
				saving = null;
				await update({ reset: false });
			};
		};
	}

	const onOff = (v: boolean | undefined) => (v ? 'On' : 'Off');

	/**
	 * The time of the last check, or nothing when the answer carried no readable
	 * one.
	 *
	 * An unguarded parse of a missing or malformed timestamp renders the literal
	 * string "Invalid Date" beside the badge, which reads as a value the engine
	 * sent rather than as one it did not.
	 */
	const checkedAt = $derived(formatDateTime(data.poolHealth.checked_at, '') || null);

	// Same guard for the tail: an entry whose timestamp will not parse keeps its
	// raw value, which is at least what arrived, rather than "Invalid Date".
	function fmtTime(ts: string): string {
		return formatTime(ts, ts);
	}

	/**
	 * One entry off the SSE tail.
	 *
	 * `level` is slog's severity integer (-4, 0, 4, 8), not the label. The
	 * engine serializes the ring buffer entry as it holds it and nothing turns
	 * the number back into a name on the way out. Typed as a string, the badge
	 * below would call a string method on a number and take the whole table
	 * down with it.
	 */
	interface LogEntry {
		timestamp: string;
		level: number;
		message: string;
		tenant_id?: string;
		plugin?: string;
		attrs?: Record<string, string>;
		sequence: number;
	}

	let logEntries = $state<LogEntry[]>([]);
	let logConnected = $state(false);
	let logPaused = $state(false);
	let logMinLevel = $state('INFO');
	let logKeyword = $state('');

	const MAX_LOG_ENTRIES = 200;

	// The stream reads the level and the keyword to build its URL, so it is
	// reopened by the effect below whenever either changes. The keyword is
	// applied after a pause, because a stream reopened on every keystroke would
	// tear down and rebuild the tail once per character.
	let appliedKeyword = $state('');
	const KEYWORD_DEBOUNCE_MS = 300;

	let logEs: EventSource | null = null;
	let logRetry: ReturnType<typeof setTimeout> | null = null;
	let logDestroyed = false;

	// The badge tells the truth: Connected only while a stream is open, and
	// Reconnecting from the moment one is closed until the next one opens.
	function closeLogStream() {
		if (logRetry !== null) {
			clearTimeout(logRetry);
			logRetry = null;
		}
		logEs?.close();
		logEs = null;
		logConnected = false;
	}

	// A live tail is a stream, not a page read, so it stays on the client. The
	// filter is applied at the source: the stream is reopened rather than
	// filtered here, so a narrowed level also narrows what crosses the wire.
	function connectLogStream(minLevel: string, keyword: string) {
		if (logDestroyed) return;
		closeLogStream();

		const params = new URLSearchParams({ min_level: minLevel.toLowerCase() });
		if (keyword) params.set('keyword', keyword);

		const es = new EventSource(`/api/admin/logs/stream?${params}`);
		logEs = es;

		es.addEventListener('open', () => {
			if (logEs === es) logConnected = true;
		});

		es.addEventListener('log', (e: MessageEvent) => {
			if (logPaused) return;
			try {
				const entry: LogEntry = JSON.parse(e.data as string);
				logEntries = [entry, ...logEntries].slice(0, MAX_LOG_ENTRIES);
			} catch { /* ignore malformed */ }
		});

		// A stream the page closed by hand never errors, so this fires only for
		// the connection that is still current, and a stale one is ignored.
		es.addEventListener('error', () => {
			if (logEs !== es) return;
			closeLogStream();
			if (!logDestroyed) logRetry = setTimeout(() => connectLogStream(minLevel, keyword), 3000);
		});
	}

	function setMinLevel(level: string) {
		logMinLevel = level;
	}

	function applyKeyword(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			appliedKeyword = logKeyword.trim();
		}
	}

	$effect(() => {
		const next = logKeyword.trim();
		const timer = setTimeout(() => { appliedKeyword = next; }, KEYWORD_DEBOUNCE_MS);
		return () => clearTimeout(timer);
	});

	// This effect tracks only the two filter values. Its cleanup closes the
	// stream it opened and nothing more, so a filter change is a close followed
	// by a reopen. The destroyed flag belongs to unmount alone, below.
	$effect(() => {
		const minLevel = logMinLevel;
		const keyword = appliedKeyword;
		logEntries = [];
		connectLogStream(minLevel, keyword);
		return () => closeLogStream();
	});

	onMount(() => () => {
		logDestroyed = true;
		closeLogStream();
	});
</script>

<PageTitle title="Observability" />

{#snippet noPoolHealth()}
	<Database size={ICON.lg} />
{/snippet}

{#snippet noLatency()}
	<Gauge size={ICON.lg} />
{/snippet}

{#snippet noGoroutineEngine()}
	<Cpu size={ICON.lg} />
{/snippet}

{#snippet tunableStatus(which: TunableForm)}
	{@const note = tunableNote(which)}
	{@const refusal = formRefusal(note)}
	{#if refusal}
		<RefusalNotice {refusal} />
	{:else if note?.error}
		<Alert tone="danger">{note.error}</Alert>
	{:else if note?.saved}
		<Alert tone="success" autoDismiss>Applied. The change holds until the engine restarts.</Alert>
	{/if}
{/snippet}

{#snippet noLogEntries()}
	<Activity size={ICON.lg} />
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
	     a deployment with no pooler answers this way every time, and a warning
	     that greets every visit stops being read. The figures are one row. -->
	<Card>
		{#snippet header()}
			<div class="flex flex-wrap items-center gap-2">
				<SectionHeading level={2}>Connection pool</SectionHeading>
				{#if data.poolHealth.engine}
					{#if !data.poolHealth.healthy}
						<Badge tone="danger" class="shrink-0 whitespace-nowrap"><AlertTriangle size={ICON.xs} /> Unhealthy</Badge>
					{:else if poolStats}
						<Badge tone="success" class="shrink-0 whitespace-nowrap"><CheckCircle size={ICON.xs} /> Healthy</Badge>
					{:else}
						<Badge tone="warn" class="shrink-0 whitespace-nowrap"><AlertTriangle size={ICON.xs} /> Health unconfirmed</Badge>
					{/if}
				{/if}
				<span class="ms-auto text-xs text-faint">
					{#if checkedAt}Last checked {checkedAt}{:else}No check time reported{/if}
					{#if data.poolHealth.pooler_config}, pooler {data.poolHealth.pooler_config}{/if}
				</span>
			</div>
		{/snippet}

		{#if data.poolHealth.engine}
			<div class="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-7" data-testid="pool-stats">
				<Stat size="sm" label="Engine" value={data.poolHealth.engine} />
				<Stat size="sm" label="Ping latency" mono value={data.poolHealth.latency ? fmtUs(data.poolHealth.latency) : NO_VALUE} />
				<Stat size="sm" label="Goroutines" mono value={data.goroutines ?? NO_VALUE} />
				{#if poolStats}
					<Stat size="sm" label="Open" mono value={poolStats.open_connections} />
					<Stat size="sm" label="In use" mono value={poolStats.in_use} />
					<Stat size="sm" label="Idle" mono value={poolStats.idle} />
					<Stat size="sm" label="Wait count" mono value={poolStats.wait_count} />
				{/if}
			</div>
			{#if !poolStats}
				<!-- The tiles are omitted rather than dashed. Four dashes in a row
				     read as four measurements of nothing. -->
				<p class="mt-3 text-xs text-muted">
					The engine reported no connection statistics, so nothing here can say how many
					connections are open or how long callers wait for one. A deployment with no pooler
					configured answers this way.
				</p>
			{/if}
			{#if data.poolHealth.errors && data.poolHealth.errors.length > 0}
				<div class="mt-3">
					<Alert tone="danger" title="Pool reported errors">
						<ul class="flex flex-col gap-1">
							{#each data.poolHealth.errors as err (err)}
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

	<!-- The goroutine engine plugin's views of the engine's scaling
	     primitives. Every admin reads the four views and the per-owner counts.
	     The tunables need super_admin, and a form that cannot succeed says why
	     instead of failing. -->
	<section class="flex flex-col gap-4" data-testid="goroutine-engine">
		<div class="flex flex-wrap items-center gap-2">
			<SectionHeading level={2}>Goroutine engine</SectionHeading>
			<Badge tone="violet" size="sm">Beta</Badge>
			<span class="text-xs text-faint">Tunables hold until the engine restarts.</span>
		</div>

		{#if !geAnswered}
			<EmptyState
				iconSnippet={noGoroutineEngine}
				title="Goroutine engine unavailable"
				description="The engine did not answer with its pool, parallel or async hook state."
			/>
		{:else}
			<div class="grid gap-4 md:grid-cols-2" data-testid="goroutine-views">
				<Card>
					{#snippet header()}
						<SectionHeading level={3}>Tracker</SectionHeading>
					{/snippet}
					{#if ge.snapshot}
						<div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
							<Stat size="sm" label="Tracked" mono value={ge.snapshot.total} />
							<Stat size="sm" label="Runtime" mono value={ge.snapshot.runtime_total ?? NO_VALUE} />
							<Stat size="sm" label="Ceiling" mono value={ge.snapshot.max_goroutines ?? NO_VALUE} />
							<Stat size="sm" label="Leak threshold" mono value={formatGoDuration(ge.snapshot.leak_threshold)} />
						</div>
					{:else}
						<p class="text-xs text-muted">The tracker did not answer.</p>
					{/if}
				</Card>

				<Card>
					{#snippet header()}
						<SectionHeading level={3}>Worker pool</SectionHeading>
					{/snippet}
					{#if ge.pool}
						<div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
							<Stat size="sm" label="Size" mono value={ge.pool.size} />
							<Stat size="sm" label="Active" mono value={ge.pool.active} />
							<Stat size="sm" label="Waiting" mono value={ge.pool.waiting ?? NO_VALUE} />
							<Stat size="sm" label="Completed" mono value={ge.pool.completed} />
							<Stat size="sm" label="Failed" mono value={ge.pool.failed} tone={ge.pool.failed > 0 ? 'warn' : undefined} />
							<Stat size="sm" label="Dropped" mono value={ge.pool.dropped} tone={ge.pool.dropped > 0 ? 'danger' : undefined} />
							<Stat size="sm" label="Avg latency" mono value={formatGoDuration(ge.pool.avg_latency)} />
							<Stat size="sm" label="Task timeout" mono value={formatGoDuration(ge.pool.task_timeout)} />
						</div>
					{:else}
						<p class="text-xs text-muted">This install runs without a worker pool.</p>
					{/if}
				</Card>

				<Card>
					{#snippet header()}
						<SectionHeading level={3}>Parallel engine</SectionHeading>
					{/snippet}
					{#if ge.parallel}
						<div class="grid grid-cols-2 gap-4">
							<Stat size="sm" label="Max concurrent" mono value={ge.parallel.max_concurrent} />
							<Stat size="sm" label="Timeout" mono value={formatGoDuration(ge.parallel.timeout)} />
						</div>
					{:else}
						<p class="text-xs text-muted">This install runs without a parallel engine.</p>
					{/if}
				</Card>

				<Card>
					{#snippet header()}
						<SectionHeading level={3}>Async hooks</SectionHeading>
					{/snippet}
					{#if ge.asyncHooks}
						<div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
							<Stat size="sm" label="Enabled" value={onOff(ge.asyncHooks.enabled)} tone={ge.asyncHooks.enabled ? 'success' : undefined} />
							<Stat size="sm" label="Workers" mono value={ge.asyncHooks.workers ?? NO_VALUE} />
							<Stat size="sm" label="Queue size" mono value={ge.asyncHooks.queue_size ?? NO_VALUE} />
							<Stat size="sm" label="Timeout" mono value={formatGoDuration(ge.asyncHooks.timeout)} />
							<Stat size="sm" label="Queued" mono value={ge.asyncHooks.queued ?? NO_VALUE} />
							<Stat size="sm" label="Running" mono value={ge.asyncHooks.running ?? NO_VALUE} />
							<Stat size="sm" label="Overflow" mono value={ge.asyncHooks.overflow ?? NO_VALUE} tone={(ge.asyncHooks.overflow ?? 0) > 0 ? 'warn' : undefined} />
							<Stat size="sm" label="Dropped" mono value={ge.asyncHooks.dropped ?? NO_VALUE} tone={(ge.asyncHooks.dropped ?? 0) > 0 ? 'danger' : undefined} />
						</div>
					{:else}
						<p class="text-xs text-muted">This install runs without an async hook executor.</p>
					{/if}
				</Card>
			</div>

			<Card>
				{#snippet header()}
					<div class="flex flex-wrap items-center gap-2">
						<SectionHeading level={3}>Goroutines by owner</SectionHeading>
						<span class="ms-auto text-xs text-faint">{ge.byOwner.length} owners</span>
					</div>
				{/snippet}
				{#if ge.byOwner.length === 0}
					<p class="text-sm text-muted">
						No tracked goroutine has an owner yet. Every goroutine a plugin or an engine
						subsystem starts through the tracker is counted here under its name.
					</p>
				{:else}
					<div data-testid="goroutine-owners">
					<Table label="Goroutines by owner">
						<thead>
							<tr>
								<th scope="col">Owner</th>
								<th scope="col" class="text-right">Goroutines</th>
								<th scope="col" class="text-right">Oldest</th>
							</tr>
						</thead>
						<tbody>
							{#each ge.byOwner as row (row.owner)}
								<tr>
									<td data-cell="nowrap" class="font-mono text-xs">{row.owner}</td>
									<td data-cell="nowrap" class="text-right font-mono text-xs">{row.total}</td>
									<td data-cell="nowrap" class="text-right font-mono text-xs">{row.oldest || NO_VALUE}</td>
								</tr>
							{/each}
						</tbody>
					</Table>
					</div>
				{/if}
			</Card>

			{#if !ge.superAdmin}
				<p class="text-xs text-muted" data-testid="goroutine-role-note">
					Only a super admin can change these.
				</p>
			{/if}
			{#if !ge.licensed}
				<div class="flex flex-wrap items-center gap-2" data-testid="goroutine-license-note">
					<p class="text-xs text-muted">
						Changing these settings on a running server needs a license that includes tuning. The readings above stay available.
					</p>
					<Button variant="ghost" size="sm" href={LICENSE_PAGE}>View the license</Button>
				</div>
			{/if}

			<div class="grid gap-4 lg:grid-cols-3" data-testid="goroutine-tunables">
				<Card>
					{#snippet header()}
						<SectionHeading level={3}>Resize the pool</SectionHeading>
					{/snippet}
					<form method="POST" action="?/pool" use:enhance={tunable('pool')} class="flex flex-col gap-4" aria-label="Resize the pool">
						<fieldset disabled={!canTune || !ge.pool} class="flex flex-col gap-4">
							<NumberInput
								id="ge-pool-size"
								name="size"
								label="Pool size"
								hint="Workers the pool runs at once, {POOL_SIZE.min} to {POOL_SIZE.max}."
								min={POOL_SIZE.min}
								max={POOL_SIZE.max}
								bind:value={poolSize}
							/>
							<div>
								<Button type="submit" variant="primary" size="sm" loading={saving === 'pool'}>Apply</Button>
							</div>
						</fieldset>
						{@render tunableStatus('pool')}
					</form>
				</Card>

				<Card>
					{#snippet header()}
						<SectionHeading level={3}>Parallel engine</SectionHeading>
					{/snippet}
					<form method="POST" action="?/parallel" use:enhance={tunable('parallel')} class="flex flex-col gap-4" aria-label="Reconfigure the parallel engine">
						<fieldset disabled={!canTune || !ge.parallel} class="flex flex-col gap-4">
							<NumberInput
								id="ge-parallel-max"
								name="max_concurrent"
								label="Max concurrent"
								hint="Items in flight at once, {PARALLEL_MAX_CONCURRENT.min} to {PARALLEL_MAX_CONCURRENT.max}."
								min={PARALLEL_MAX_CONCURRENT.min}
								max={PARALLEL_MAX_CONCURRENT.max}
								bind:value={parallelMax}
							/>
							<Input
								id="ge-parallel-timeout"
								name="timeout"
								label="Timeout"
								hint="Per-item deadline as a duration, up to {PARALLEL_TIMEOUT_MAX}."
								placeholder="30s"
								bind:value={parallelTimeout}
								autocomplete="off"
								mono
							/>
							<div>
								<Button type="submit" variant="primary" size="sm" loading={saving === 'parallel'}>Apply</Button>
							</div>
						</fieldset>
						{@render tunableStatus('parallel')}
					</form>
				</Card>

				<Card>
					{#snippet header()}
						<SectionHeading level={3}>Async hooks</SectionHeading>
					{/snippet}
					<form method="POST" action="?/asyncHooks" use:enhance={tunable('asyncHooks')} class="flex flex-col gap-4" aria-label="Reconfigure the async hooks">
						<fieldset disabled={!canTune || !ge.asyncHooks} class="flex flex-col gap-4">
							<NumberInput
								id="ge-async-workers"
								name="workers"
								label="Workers"
								hint="{ASYNC_WORKERS.min} to {ASYNC_WORKERS.max}."
								min={ASYNC_WORKERS.min}
								max={ASYNC_WORKERS.max}
								bind:value={asyncWorkers}
							/>
							<NumberInput
								id="ge-async-queue"
								name="queue_size"
								label="Queue size"
								hint="Hooks waiting for a worker before one runs inline, {ASYNC_QUEUE_SIZE.min} to {ASYNC_QUEUE_SIZE.max}."
								min={ASYNC_QUEUE_SIZE.min}
								max={ASYNC_QUEUE_SIZE.max}
								bind:value={asyncQueue}
							/>
							<Input
								id="ge-async-timeout"
								name="timeout"
								label="Timeout"
								hint="Per-hook deadline as a duration, up to {ASYNC_TIMEOUT_MAX}."
								placeholder="5s"
								bind:value={asyncTimeout}
								autocomplete="off"
								mono
							/>
							<Checkbox
								id="ge-async-enabled"
								name="enabled"
								label="Run hooks asynchronously"
								description="Off runs every hook inline on the request that fired it."
								bind:checked={asyncEnabled}
							/>
							<div>
								<Button type="submit" variant="primary" size="sm" loading={saving === 'asyncHooks'}>Apply</Button>
							</div>
						</fieldset>
						{@render tunableStatus('asyncHooks')}
					</form>
				</Card>
			</div>
		{/if}
	</section>

	<section class="flex flex-col gap-4">
		<div class="flex items-center gap-2">
			<SectionHeading level={2}>Latency rankings</SectionHeading>
		</div>

		<ListToolbar label="Latency rankings">
			{#snippet search()}
				<span class="text-xs text-muted">{data.latency.total} endpoints tracked</span>
			{/snippet}
			{#snippet filters()}
				<label for="latency-top" class="sr-only">Rows</label>
				<Select
					id="latency-top"
					options={LATENCY_TOP_CHOICES.map((c) => ({ value: String(c), label: `Top ${c}` }))}
					value={String(data.top)}
					onvaluechange={setLatencyTop}
					class="w-32"
				/>
			{/snippet}
		</ListToolbar>

		{#if data.latency.slowest.length === 0}
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
					{#each data.latency.slowest as entry, i (`${entry.method} ${entry.path}`)}
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

	<section class="flex flex-col gap-4">
		<div class="flex items-center gap-2">
			<SectionHeading level={2}>Live log tail</SectionHeading>
			{#if logConnected}
				<Badge tone="success" dot>Connected</Badge>
			{:else}
				<Badge tone="warn" dot>Reconnecting</Badge>
			{/if}
			<span class="text-xs text-faint">{logEntries.length} entries</span>
		</div>

		<ListToolbar label="Filter the log tail">
			{#snippet search()}
				<label for="tail-keyword" class="sr-only">Filter</label>
				<Input id="tail-keyword" bind:value={logKeyword} placeholder="Keyword, then Enter" onkeydown={applyKeyword} />
			{/snippet}
			{#snippet filters()}
				<label for="tail-level" class="sr-only">Minimum level</label>
				<Select
					id="tail-level"
					options={LOG_LEVELS.map((lv) => ({ value: lv, label: lv }))}
					value={logMinLevel}
					onvaluechange={setMinLevel}
					class="w-36"
				/>
				<Button variant={logPaused ? 'primary' : 'secondary'} onclick={() => { logPaused = !logPaused; }}>
					{logPaused ? 'Resume' : 'Pause'}
				</Button>
				<Button variant="secondary" onclick={() => { logEntries = []; }}>
					<Trash2 size={ICON.sm} /> Clear
				</Button>
			{/snippet}
		</ListToolbar>

		{#if logEntries.length === 0}
			<EmptyState
				iconSnippet={noLogEntries}
				title="Waiting for log entries"
				description="Entries at the selected level appear here as the engine emits them."
			/>
		{:else}
			<div class="max-h-96 overflow-y-auto overscroll-contain rounded-xl">
				<Table hoverable label="Live log tail">
					<tbody>
						{#each logEntries as entry (entry.sequence)}
							<tr class="align-top">
								<td class="whitespace-nowrap font-mono text-xs">
									<span class="text-faint">{fmtTime(entry.timestamp)}</span>
								</td>
								<td class="whitespace-nowrap">
									<Badge tone={logLevelTone(entry.level)}>{logLevelLabel(entry.level)}</Badge>
								</td>
								<td class="font-mono text-xs">{entry.message}</td>
								<td class="whitespace-nowrap text-xs">
									<span class="text-faint">
										{#if entry.tenant_id}<span class="mr-2">tenant {entry.tenant_id}</span>{/if}
										{#if entry.plugin}<span>plugin {entry.plugin}</span>{/if}
									</span>
								</td>
							</tr>
						{/each}
					</tbody>
				</Table>
			</div>
		{/if}
	</section>
</PageShell>
