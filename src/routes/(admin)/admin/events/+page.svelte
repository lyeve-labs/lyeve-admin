<script lang="ts">
	import PageTitle from '$lib/components/PageTitle.svelte';
	import {
		Alert,
		Badge,
		Button,
		Card,
		Checkbox,
		DateTimePicker,
		EmptyState,
		Input,
		PageShell,
		SearchInput,
		SectionHeading,
		Stat,
		Table,
		Pagination,
	} from '@lyeve-labs/ui-kit';
	import { enhance } from '$app/forms';
	import { browserOffset } from '$lib/utils/wall-clock';
	import { invalidateAll } from '$app/navigation';
	import { History, RefreshCw, Rss, Search } from '@lucide/svelte';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import FormErrors from '$lib/components/FormErrors.svelte';
	import ListToolbar from '$lib/components/ListToolbar.svelte';
	import { didFire, failedOnly, progressOf, runTone } from '$lib/api/events';
	import { NO_VALUE, formatDateTime } from '$lib/format';
	import type { ActionData, PageData } from './$types';
	import { pageHref, pageNumber } from '$lib/api/list';
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

	let narrow = $state('');
	let failedFirst = $state(false);
	// A replay is rehearsed by default. It posts every event in the window to
	// a handler again, and nothing undoes that.
	let dryRun = $state(true);
	let since = $state('');
	// The action runs in the server's zone, so the browser's offset goes with the value.
	const sinceOffset = $derived(browserOffset(since));
	let handler = $state('');
	let starting = $state(false);

	const pool = $derived(failedFirst ? failedOnly(data.events) : data.events);
	const visible = $derived(
		narrow.trim()
			? pool.filter((e) =>
					`${e.topic} ${e.event_type} ${e.source} ${e.schema_name}`
						.toLowerCase()
						.includes(narrow.trim().toLowerCase()),
				)
			: pool,
	);

	const failures = $derived(failedOnly(data.events).length);
</script>

<PageTitle title="Events" />

<PageShell
	title="Events"
	description="The durable log of what this instance published, and the replays run against it."
	width="wide"
>
	{#snippet actions()}
		<Button variant="secondary" size="sm" onclick={refresh} loading={refreshing}>
			<RefreshCw size={ICON.sm} /> Refresh
		</Button>
	{/snippet}

	{#if data.gate.state !== 'ok'}
		<GateNotice
			gate={data.gate}
			title="Event log"
			absent="The events plugin is not part of this build, so nothing is being recorded."
		/>
	{:else}
		<FormErrors message={form?.error} />
		{#if form?.started}
			<Alert tone={form.dryRun ? 'brand' : 'success'} autoDismiss={!form.dryRun}>
				{form.dryRun
					? 'Rehearsed. Nothing was posted to a handler. Clear the rehearsal box to run it for real.'
					: 'Replay started. It runs in the background and the panel below reports it.'}
			</Alert>
		{/if}

		<div class="grid gap-4 sm:grid-cols-3">
			<Stat size="sm" mono label="Recorded" value={data.total} />
			<Stat
				size="sm"
				mono
				label="Carrying an error"
				value={failures}
				tone={failures > 0 ? 'danger' : undefined}
			/>
			<Stat size="sm" mono label="Recent replays" value={data.runs.length} />
		</div>

		<section class="flex flex-col gap-4">
			<SectionHeading level={2}>Replay</SectionHeading>
			<Card>
				<form
					method="post"
					action="?/replay"
					use:enhance={() => {
						starting = true;
						return async ({ update }) => {
							starting = false;
							await update();
						};
					}}
					class="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
				>
					<DateTimePicker name="since" label="Replay from" bind:value={since} required />
					<input type="hidden" name="since_offset" value={sinceOffset} />
					<Input
						name="handler"
						label="Handler"
						placeholder="Every handler when empty"
						bind:value={handler}
					/>
					<input type="hidden" name="dry_run" value={String(dryRun)} />
					<Button variant="primary" type="submit" loading={starting}>
						<History size={ICON.sm} />
						{dryRun ? 'Rehearse' : 'Replay'}
					</Button>
				</form>
				<div class="mt-3">
					<Checkbox bind:checked={dryRun} label="Rehearse first, posting nothing" />
					<p class="mt-1 text-xs text-muted">
						A replay posts every event in the window to its handler again, and nothing undoes
						that. The rehearsal reports the same counts without firing anything.
					</p>
				</div>
			</Card>

			{#if data.runs.length > 0}
				<Table label="Replay">
					<thead>
						<tr>
							<th scope="col">Started</th>
							<th scope="col">Handler</th>
							<th scope="col">Status</th>
							<th scope="col">Progress</th>
							<th scope="col">Result</th>
						</tr>
					</thead>
					<tbody>
						{#each data.runs as run (run.run_id)}
							<tr>
								<td data-cell="nowrap" class="text-xs">{formatDateTime(run.started_at)}</td>
								<td data-cell="nowrap" class="font-mono text-xs">{run.handler || 'every'}</td>
								<td data-cell="nowrap">
									<Badge tone={runTone(run.status)}>{run.status}</Badge>
									{#if run.dry_run}
										<Badge tone="neutral">rehearsal</Badge>
									{/if}
								</td>
								<td data-cell="nowrap" class="text-xs"
									>{Math.round(progressOf(run) * 100)}% of {run.total_events}</td
								>
								<td class="text-xs">
									{#if run.error}
										<span class="text-danger">{run.error}</span>
									{:else}
										{run.replayed} replayed, {run.skipped} skipped, {run.failed} failed
										{#if !didFire(run)}
											<span class="text-faint">(nothing was posted)</span>
										{/if}
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</Table>
			{/if}
		</section>

		<section class="flex flex-col gap-4">
			<SectionHeading level={2}>Published</SectionHeading>

			{#if data.events.length === 0}
				<EmptyState
					title="Nothing has been published"
					description="The log records an event when a plugin or a flow publishes one. An empty log is a quiet instance."
				>
					{#snippet iconSnippet()}
						<Rss size={ICON.lg} />
					{/snippet}
				</EmptyState>
			{:else}
				<ListToolbar label="Filter published events">
					{#snippet search()}
						<SearchInput
							id="event-narrow"
							bind:value={narrow}
							placeholder="Topic, type or source on this page"
						/>
					{/snippet}
					{#snippet filters()}
						<Checkbox bind:checked={failedFirst} label="Only those carrying an error" />
					{/snippet}
				</ListToolbar>

				<Table label="Published">
					<thead>
						<tr>
							<th scope="col">Published</th>
							<th scope="col">Topic</th>
							<th scope="col">Type</th>
							<th scope="col">Source</th>
							<th scope="col">Schema</th>
						</tr>
					</thead>
					<tbody>
						{#each visible as row (row.id)}
							<tr>
								<td data-cell="nowrap" class="text-xs text-faint"
									>{formatDateTime(row.published_at)}</td
								>
								<td data-cell="nowrap" class="font-mono text-xs">
									{row.topic}
									{#if row.error}
										<Badge tone="danger">error</Badge>
									{/if}
								</td>
								<td data-cell="nowrap" class="text-xs">{row.event_type}</td>
								<td data-cell="nowrap" class="text-xs">{row.source || NO_VALUE}</td>
								<td data-cell="nowrap" class="text-xs">{row.schema_name || NO_VALUE}</td>
							</tr>
						{/each}
					</tbody>
				</Table>
				<Pagination
					page={pageNumber(data.offset, data.limit)}
					perPage={data.limit}
					count={data.events.length}
					total={data.total ?? undefined}
					noun="events"
					href={pageHref('/admin/events', data.limit)}
				/>

				{#if visible.length === 0}
					<EmptyState
						title="Nothing on this page matches"
						description="Clear the filter to see the rest."
					>
						{#snippet iconSnippet()}
							<Search size={ICON.lg} />
						{/snippet}
					</EmptyState>
				{/if}
			{/if}
		</section>
	{/if}
</PageShell>
