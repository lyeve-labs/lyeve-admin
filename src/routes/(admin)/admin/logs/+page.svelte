<script lang="ts">
	import PageTitle from '$lib/components/PageTitle.svelte';
	import {
		Badge,
		Button,
		Card,
		EmptyState,
		PageShell,
		Pagination,
		SearchInput,
		SectionHeading,
		Select,
		Table,
	} from '@lyeve-labs/ui-kit';
	import type { PageData } from './$types';
	import { levelName } from '$lib/api/helpers';
	import { pageHref, pageNumber } from '$lib/api/list';
	import { LOG_PAGE_SIZES } from '$lib/api/logs';
	import { LOG_LEVELS, NO_VALUE, formatDateTime, hasTrace, logLevelTone } from '$lib/format';
	import { FileText, Activity, AlertTriangle, BellRing } from '@lucide/svelte';
	import ListToolbar from '$lib/components/ListToolbar.svelte';
	import { ICON } from '$lib/icon';

	let { data }: { data: PageData } = $props();

	const byLevel = $derived(data.volume?.by_level ?? {});
	const overrideCount = $derived(
		data.levels
			? Object.keys(data.levels.tenants ?? {}).length +
					Object.keys(data.levels.plugins ?? {}).length
			: 0
	);

	// The filter that every link on this page has to carry. An entry position
	// is left out on purpose: a level chip starts from the first page, because
	// an offset into one level's list means nothing in another.
	const filter = $derived({ ...(data.q ? { q: data.q } : {}), ...(data.level ? { level: data.level } : {}) });
	const page = $derived(pageHref('/admin/logs', data.limit, filter));

	// The active chip links to the same view without the level, so a second
	// click clears the filter it set.
	function levelHref(lv: string): string {
		const params = { ...(data.q ? { q: data.q } : {}), ...(lv === data.level ? {} : { level: lv }) };
		return pageHref('/admin/logs', data.limit, params)(1);
	}

	// An entry whose timestamp will not parse keeps its raw value, which is at
	// least what arrived, rather than "Invalid Date".
	function fmtTime(ts: string): string {
		return formatDateTime(ts, ts);
	}
</script>

<PageTitle title="Logs" />

{#snippet emptyIcon()}
	<FileText size={ICON.lg} />
{/snippet}

<PageShell
	title="Logs"
	description="Log entries, their levels and the volume behind them."
	width="wide"
>
	{#snippet actions()}
		<Button variant="secondary" size="sm" href="/admin/logs/alerts">
			<BellRing size={ICON.sm} /> Volume alerts
		</Button>
	{/snippet}

	<section class="flex flex-col gap-4">
		<SectionHeading level={2}>Volume and levels</SectionHeading>

		<div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
			<Card>
				<div class="flex items-center gap-2 text-xs uppercase tracking-wide text-faint">
					<Activity size={ICON.sm} /> Volume (24h)
				</div>
				<p class="mt-2 text-2xl font-bold text-brand">{data.volume?.total ?? NO_VALUE}</p>
				<div class="mt-2 flex flex-wrap gap-1.5">
					{#each LOG_LEVELS as lv (lv)}
						{#if byLevel[lv]}
							<a
								href={levelHref(lv)}
								aria-current={lv === data.level ? 'true' : undefined}
								aria-label={lv === data.level ? 'Show all levels' : `Show only ${lv} entries`}
								class={`relative -my-0.5 py-0.5 hit-area inline-flex rounded-full ring-offset-1 hover:opacity-80 ${lv === data.level ? 'ring-2 ring-brand' : ''}`}
							>
								<Badge tone={logLevelTone(lv)}>{lv} {byLevel[lv]}</Badge>
							</a>
						{/if}
					{/each}
				</div>
			</Card>

			<Card>
				<div class="text-xs uppercase tracking-wide text-faint">Default level</div>
				<p class="mt-2 text-2xl font-bold text-brand">
					{data.levels ? levelName(data.levels.default_level) : NO_VALUE}
				</p>
				<p class="mt-2 text-xs text-faint">
					{overrideCount} tenant and plugin {overrideCount === 1 ? 'override' : 'overrides'}
				</p>
			</Card>

			<Card>
				<div class="text-xs uppercase tracking-wide text-faint">Sinks</div>
				<div class="mt-2 flex flex-wrap gap-1.5">
					{#if data.config?.sinks?.length}
						{#each data.config.sinks as sink (sink.driver)}
							<Badge tone="neutral">{sink.driver}</Badge>
						{/each}
					{:else}
						<span class="text-sm text-faint">{NO_VALUE}</span>
					{/if}
				</div>
				{#if data.volume?.alerts?.length}
					<p class="mt-2 flex items-center gap-1 text-xs text-warn">
						<AlertTriangle size={ICON.xs} />
						{data.volume.alerts.length} volume {data.volume.alerts.length === 1 ? 'alert' : 'alerts'}
					</p>
				{/if}
			</Card>
		</div>
	</section>

	<section class="flex flex-col gap-4">
		<SectionHeading level={2}>Entries</SectionHeading>

		<!-- A GET form: the filter lives in the URL, so a filtered view is a link
		     someone can keep and the results still render without hydration. -->
		<form method="GET">
			<ListToolbar label="Filter log entries">
				{#snippet search()}
					<div class="flex items-center gap-2">
						<label for="log-search" class="sr-only">Search</label>
						<SearchInput
							id="log-search"
							name="q"
							value={data.q}
							placeholder="Messages, fields, trace IDs"
							class="min-w-0 flex-1"
						/>
						<Button type="submit" variant="secondary">Search</Button>
					</div>
				{/snippet}
				{#snippet filters()}
					<label for="log-level" class="sr-only">Level</label>
					<Select
						id="log-level"
						name="level"
						options={[{ value: '', label: 'All levels' }, ...LOG_LEVELS.map((lv) => ({ value: lv, label: lv }))]}
						value={data.level}
						class="w-40"
					/>
					<label for="log-limit" class="sr-only">Per page</label>
					<Select
						id="log-limit"
						name="limit"
						options={LOG_PAGE_SIZES.map((size) => ({ value: String(size), label: `${size} per page` }))}
						value={String(data.limit)}
						class="w-36"
					/>
				{/snippet}
			</ListToolbar>
		</form>

		{#if data.entries.length === 0}
			<EmptyState
				iconSnippet={emptyIcon}
				title="No log entries match the current filter"
				description="Widen the level or clear the search to see more."
			/>
		{:else}
			<div class="flex flex-col gap-2">
				<Table label="Entries">
					<thead>
						<tr>
							<th scope="col">Time</th>
							<th scope="col">Level</th>
							<th scope="col">Plugin</th>
							<th scope="col">Message</th>
						</tr>
					</thead>
					<tbody>
						{#each data.entries as entry, i (entry.timestamp + i)}
							<tr class="align-top">
								<td class="whitespace-nowrap text-xs">
									<span class="text-faint">{fmtTime(entry.timestamp)}</span>
								</td>
								<td>
									<Badge tone={logLevelTone(entry.level)}>{entry.level}</Badge>
								</td>
								<td class="whitespace-nowrap text-xs">
									<span class="text-muted">{entry.plugin ?? NO_VALUE}</span>
								</td>
								<td>
									{entry.message}
									{#if hasTrace(entry.trace_id)}
										<span class="ml-2 text-xs text-faint">trace={entry.trace_id}</span>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</Table>
				<Pagination
					page={pageNumber(data.offset, data.limit)}
					perPage={data.limit}
					count={data.entries.length}
					total={data.total ?? undefined}
					noun="entries"
					href={page}
				/>
			</div>
		{/if}
	</section>
</PageShell>
