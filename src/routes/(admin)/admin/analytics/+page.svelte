<script lang="ts">
	import PageTitle from '$lib/components/PageTitle.svelte';
	import {
		Badge,
		Card,
		EmptyState,
		PageShell,
		Progress,
		SectionHeading,
		Stat,
		Table,
	} from '@lyeve-labs/ui-kit';
	import { TrendingUp, Gauge, Globe, Server } from '@lucide/svelte';
	import { NO_VALUE, formatCount, formatDateTime } from '$lib/format';
	import type { PageData } from './$types';
	import type { BreakdownItem } from '@lyeve-labs/client-rest';
	import { ICON } from '$lib/icon';

	let { data }: { data: PageData } = $props();

	// The engine encodes an empty result as a null array, not []. Dereferenced
	// directly, an instance with no anomalies, the normal state, would fail the
	// whole page on a read of null.length.
	const summary = $derived(data.summary);
	const endpoints = $derived(data.endpoints.items ?? []);
	const methods = $derived(data.methods.items ?? []);
	const agents = $derived(data.agents.items ?? []);
	const anomalies = $derived(data.anomalies.anomalies ?? []);

	// Largest method request_count, which scales the bar rows.
	const maxMethodCount = $derived(
		methods.reduce((m: number, it: BreakdownItem) => Math.max(m, it.request_count), 0)
	);

	function fmtInt(n: number): string {
		return formatCount(n);
	}

	function fmtMs(ms: number): string {
		if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
		return `${ms.toFixed(1)}ms`;
	}

	function fmtPct(fraction: number): string {
		return `${(fraction * 100).toFixed(2)}%`;
	}

	function fmtBytes(b: number): string {
		if (b >= 1_048_576) return `${(b / 1_048_576).toFixed(1)} MB`;
		if (b >= 1024) return `${(b / 1024).toFixed(1)} KB`;
		return `${Math.round(b)} B`;
	}

	function errorRateVariant(rate: number): 'danger' | 'warn' | 'success' {
		if (rate >= 0.05) return 'danger';
		if (rate >= 0.01) return 'warn';
		return 'success';
	}

	/*
	 * Two rates, because a 4xx and a 5xx say different things about different
	 * parties. A few server errors beside thousands of client errors is a
	 * healthy engine and a caller retrying a bad token. Merged into one figure,
	 * it looks like an outage and sends somebody to read engine logs that have
	 * nothing in them.
	 *
	 * The server rate is the health number and keeps the band and the tone. The
	 * client rate is an integration number, so it is stated plainly and points
	 * at the endpoints driving it.
	 */
	const serverErrorRate = $derived(
		summary.total_requests > 0 ? summary.total_5xx / summary.total_requests : 0
	);
	const clientErrorRate = $derived(
		summary.total_requests > 0 ? summary.total_4xx / summary.total_requests : 0
	);

	// Stat carries no danger or warn accent, so the summary tile states the band
	// in words. The color signal stays on the per-endpoint badges, which are the
	// rows a reader acts on.
	function errorRateBand(rate: number): string {
		if (rate >= 0.05) return 'critical';
		if (rate >= 0.01) return 'elevated';
		return 'within threshold';
	}

	// A server error is ours and a much smaller number means much more. One in a
	// thousand is worth a look, and the combined band would have called it fine.
	function serverErrorBand(rate: number): string {
		if (rate >= 0.01) return 'critical';
		if (rate >= 0.001) return 'elevated';
		return 'within threshold';
	}

	// The endpoints a reader should open first, by how much of the total error
	// volume each one carries rather than by its own rate: a 100% rate over
	// three requests is noise beside a 20% rate over nine hundred.
	const worstEndpoints = $derived(
		[...endpoints]
			.filter((e) => e.error_rate > 0)
			.sort((a, b) => b.error_rate * b.request_count - a.error_rate * a.request_count)
			.slice(0, 3)
	);

	function severityVariant(sev: string): 'danger' | 'warn' | 'brand' | 'neutral' {
		switch (sev) {
			case 'high': return 'danger';
			case 'medium': return 'warn';
			case 'low': return 'brand';
			default: return 'neutral';
		}
	}
</script>

<PageTitle title="API analytics" />

{#snippet noEndpoints()}
	<Server size={ICON.lg} />
{/snippet}

{#snippet noAgents()}
	<Globe size={ICON.lg} />
{/snippet}

{#snippet noAnomalies()}
	<TrendingUp size={ICON.lg} />
{/snippet}

{#snippet noMethods()}
	<Gauge size={ICON.lg} />
{/snippet}

<PageShell
	title="API analytics"
	description="Request volume, latency and error rate across the public API over the last 24 hours."
	width="wide"
>
	<div class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
		<Stat size="sm" mono label="Total requests" value={fmtInt(summary.total_requests)} />
		<Stat
			size="sm"
			mono
			label="Server errors"
			value={fmtPct(serverErrorRate)}
			sub={serverErrorBand(serverErrorRate)}
			accent={serverErrorRate >= 0.001 ? 'neutral' : 'success'}
		/>
		<Stat size="sm" mono label="Client errors" value={fmtPct(clientErrorRate)} sub="the caller's" />
		<Stat size="sm" mono label="P50 latency" value={fmtMs(summary.avg_latency_p50_ms)} />
		<Stat size="sm" mono label="P95 latency" value={fmtMs(summary.avg_latency_p95_ms)} />
		<Stat size="sm" mono label="P99 latency" value={fmtMs(summary.avg_latency_p99_ms)} />
	</div>

	<!-- 2xx, 4xx and 5xx sum to the total, so three tiles would restate a
	     fourth. One bar says the same thing and says the proportion too,
	     which is the only part a reader would do arithmetic for. -->
	<Card>
		<div class="flex flex-col gap-3">
			<div class="flex flex-wrap items-baseline justify-between gap-2">
				<SectionHeading level={3}>Responses</SectionHeading>
				<span class="text-xs text-muted">
					{fmtInt(summary.unique_endpoints)} endpoints served, max P99 {fmtMs(summary.max_latency_p99_ms)}
				</span>
			</div>
			{#if summary.total_requests > 0}
				<div
					class="flex h-2.5 w-full overflow-hidden rounded-full bg-surface-2"
					role="img"
					aria-label={`${fmtInt(summary.total_2xx)} successful, ${fmtInt(summary.total_4xx)} client errors, ${fmtInt(summary.total_5xx)} server errors`}
				>
					<div class="bg-success" style:width={`${(summary.total_2xx / summary.total_requests) * 100}%`}></div>
					<div class="bg-warn" style:width={`${(summary.total_4xx / summary.total_requests) * 100}%`}></div>
					<div class="bg-danger" style:width={`${(summary.total_5xx / summary.total_requests) * 100}%`}></div>
				</div>
			{/if}
			<div class="flex flex-wrap gap-x-6 gap-y-1 text-xs">
				<span class="flex items-center gap-1.5">
					<span class="h-2 w-2 rounded-full bg-success"></span>
					<span class="text-muted">2xx</span>
					<span class="font-mono text-fg">{fmtInt(summary.total_2xx)}</span>
				</span>
				<span class="flex items-center gap-1.5">
					<span class="h-2 w-2 rounded-full bg-warn"></span>
					<span class="text-muted">4xx</span>
					<span class="font-mono text-fg">{fmtInt(summary.total_4xx)}</span>
				</span>
				<span class="flex items-center gap-1.5">
					<span class="h-2 w-2 rounded-full bg-danger"></span>
					<span class="text-muted">5xx</span>
					<span class="font-mono text-fg">{fmtInt(summary.total_5xx)}</span>
				</span>
			</div>
		</div>
	</Card>

	<!-- The rows worth opening, above the table rather than somewhere in it.
	     A route that errors on a fifth of its requests can sit mid-table with
	     nothing on the page pointing at it. -->
	{#if worstEndpoints.length > 0}
		<Card>
			<div class="flex flex-col gap-3">
				<SectionHeading level={3}>Where the errors are</SectionHeading>
				<ul class="flex flex-col gap-2">
					{#each worstEndpoints as e (e.key)}
						<li class="flex flex-wrap items-center justify-between gap-2 text-sm">
							<code class="min-w-0 truncate font-mono text-xs text-fg">{e.key}</code>
							<span class="flex shrink-0 items-center gap-3">
								<span class="text-xs text-muted">{fmtInt(e.request_count)} requests</span>
								<Badge tone={errorRateVariant(e.error_rate)}>{fmtPct(e.error_rate)}</Badge>
							</span>
						</li>
					{/each}
				</ul>
			</div>
		</Card>
	{/if}

	<section class="flex flex-col gap-4">
		<div class="flex items-center gap-2">
			<SectionHeading level={2}>Top endpoints</SectionHeading>
			<span class="text-xs text-muted">{data.endpoints.total} tracked</span>
		</div>

		{#if endpoints.length === 0}
			<EmptyState
				iconSnippet={noEndpoints}
				title="No endpoint data yet"
				description="Traffic to the public API shows up here once requests have been recorded."
			/>
		{:else}
			<Table label="Top endpoints">
				<thead>
					<tr>
						<th scope="col" class="w-8">#</th>
						<th scope="col">Endpoint</th>
						<th scope="col" class="text-right">Requests</th>
						<th scope="col" class="text-right">Error rate</th>
						<th scope="col" class="text-right">P95</th>
						<th scope="col" class="text-right">Max P99</th>
						<th scope="col" class="text-right">Avg size</th>
					</tr>
				</thead>
				<tbody>
					{#each endpoints as item, i (item.key)}
						<tr>
							<td data-cell="nowrap"><span class="text-faint">{i + 1}</span></td>
							<td data-cell="nowrap" class="font-mono text-xs">{item.key}</td>
							<td data-cell="nowrap" class="text-right font-mono text-xs">{fmtInt(item.request_count)}</td>
							<td class="text-right">
								<Badge tone={errorRateVariant(item.error_rate)}>{fmtPct(item.error_rate)}</Badge>
							</td>
							<td data-cell="nowrap" class="text-right font-mono text-xs">{fmtMs(item.avg_latency_p95_ms)}</td>
							<td data-cell="nowrap" class="text-right font-mono text-xs">{fmtMs(item.max_latency_p99_ms)}</td>
							<td data-cell="nowrap" class="text-right font-mono text-xs">
								<span class="text-faint">{fmtBytes(item.request_size_avg_bytes)}</span>
							</td>
						</tr>
					{/each}
				</tbody>
			</Table>
		{/if}
	</section>

	<div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
		<section class="flex flex-col gap-4">
			<div class="flex items-center gap-2">
				<SectionHeading level={2}>HTTP methods</SectionHeading>
			</div>

			{#if methods.length === 0}
				<EmptyState
					iconSnippet={noMethods}
					title="No method data yet"
					description="Requests are grouped by HTTP method once the engine has recorded some."
				/>
			{:else}
				<Card>
					<div class="flex flex-col gap-3">
						{#each methods as item (item.key)}
							<Progress
								label={`${item.key || NO_VALUE} (${fmtInt(item.request_count)})`}
								value={item.request_count}
								max={maxMethodCount}
								showValue
							/>
						{/each}
					</div>
				</Card>
			{/if}
		</section>

		<section class="flex flex-col gap-4">
			<div class="flex items-center gap-2">
				<SectionHeading level={2}>Top user agents</SectionHeading>
			</div>

			{#if agents.length === 0}
				<EmptyState
					iconSnippet={noAgents}
					title="No user agent data yet"
					description="Clients are grouped here once they have made a request."
				/>
			{:else}
				<Table label="Top user agents">
					<thead>
						<tr>
							<th scope="col">User agent</th>
							<th scope="col" class="text-right">Requests</th>
							<th scope="col" class="text-right">Error rate</th>
						</tr>
					</thead>
					<tbody>
						{#each agents as item (item.key)}
							<tr>
								<td data-cell="nowrap" class="font-mono text-xs">{item.key || NO_VALUE}</td>
								<td data-cell="nowrap" class="text-right font-mono text-xs">{fmtInt(item.request_count)}</td>
								<td class="text-right">
									<Badge tone={errorRateVariant(item.error_rate)}>{fmtPct(item.error_rate)}</Badge>
								</td>
							</tr>
						{/each}
					</tbody>
				</Table>
			{/if}
		</section>
	</div>

	<section class="flex flex-col gap-4">
		<div class="flex items-center gap-2">
			<SectionHeading level={2}>Anomalies</SectionHeading>
			{#if data.anomalies.window_hours > 0}
				<span class="text-xs text-muted">
					window {data.anomalies.window_hours}h, z threshold {data.anomalies.z_threshold}
				</span>
			{/if}
		</div>

		{#if anomalies.length === 0}
			<EmptyState
				iconSnippet={noAnomalies}
				title="No anomalies detected"
				description="Request volume, latency and error rate are all inside the expected band."
			/>
		{:else}
			<Table label="Anomalies">
				<thead>
					<tr>
						<th scope="col">Hour</th>
						<th scope="col">Metric</th>
						<th scope="col">Severity</th>
						<th scope="col" class="text-right">Actual</th>
						<th scope="col" class="text-right">Expected</th>
						<th scope="col" class="text-right">Z-score</th>
					</tr>
				</thead>
				<tbody>
					{#each anomalies as a, i (`${a.hour}-${a.metric_name}-${i}`)}
						<tr>
							<td class="whitespace-nowrap text-xs">{formatDateTime(a.hour)}</td>
							<td data-cell="nowrap" class="font-mono text-xs">{a.metric_name}</td>
							<td><Badge tone={severityVariant(a.severity)}>{a.severity}</Badge></td>
							<td data-cell="nowrap" class="text-right font-mono text-xs">{a.actual_value.toFixed(2)}</td>
							<td data-cell="nowrap" class="text-right font-mono text-xs">
								<span class="text-faint">{a.expected_avg.toFixed(2)}</span>
							</td>
							<td data-cell="nowrap" class="text-right font-mono text-xs">{a.z_score.toFixed(2)}</td>
						</tr>
					{/each}
				</tbody>
			</Table>
		{/if}
	</section>
</PageShell>
