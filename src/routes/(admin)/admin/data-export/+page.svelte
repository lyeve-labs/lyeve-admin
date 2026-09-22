<script lang="ts">
	import PageTitle from '$lib/components/PageTitle.svelte';
	import {
		Alert,
		Badge,
		Button,
		Drawer,
		EmptyState,
		Input,
		PageShell,
		Pagination,
		Progress,
		SearchInput,
		SectionHeading,
		Select,
		Spinner,
		Stat,
		Table,
		Toggle,
		confirm as confirmDialog,
	} from '@lyeve-labs/ui-kit';
	import { enhance } from '$app/forms';
	import { invalidate } from '$app/navigation';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { CalendarClock, Download, Pause, Play, Plus, RefreshCw, Search, Trash2, X } from '@lucide/svelte';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import FormErrors from '$lib/components/FormErrors.svelte';
	import ListToolbar from '$lib/components/ListToolbar.svelte';
	import ExportConfigFields from '$lib/components/ExportConfigFields.svelte';
	import {
		CRON_PRESETS,
		FORMAT_LABELS,
		JOBS_URL,
		active,
		cronLabel,
		downloadable,
		fileSize,
		jobProgress,
		jobTone,
		scheduleState,
		stageText,
		type ExportSchedule,
	} from '$lib/api/data-export';
	import { NO_VALUE, formatCount, formatDateTime } from '$lib/format';
	import { submitter } from '$lib/forms.svelte';
	import type { ActionData, PageData } from './$types';
	import { pageHref, pageNumber } from '$lib/api/list';
	import { ICON } from '$lib/icon';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	/** How often the list re-reads while an export is still going. */
	const POLL_MS = 2000;

	let refreshing = $state(false);
	async function refresh() {
		refreshing = true;
		try {
			await invalidate('app:data-export');
		} finally {
			refreshing = false;
		}
	}

	const running = $derived(data.jobs.filter(active));
	const failed = $derived(data.jobs.filter((j) => j.status === 'failed').length);

	// A running export moves on the server, not here, so the page re-reads
	// its load until nothing is left running and then stops asking.
	$effect(() => {
		if (running.length === 0) return;
		const id = setInterval(() => void invalidate('app:data-export'), POLL_MS);
		return () => clearInterval(id);
	});

	let narrow = $state('');
	const visible = $derived(
		narrow.trim()
			? data.jobs.filter((j) =>
					`${j.name} ${j.format} ${j.status}`.toLowerCase().includes(narrow.trim().toLowerCase()),
				)
			: data.jobs,
	);

	function downloadHref(id: string): string {
		return `${JOBS_URL}/${encodeURIComponent(id)}/download`;
	}

	function scopeText(schemas: string[] | null | undefined): string {
		if (!schemas || schemas.length === 0) return 'Every schema';
		if (schemas.length <= 3) return schemas.join(', ');
		return `${schemas.slice(0, 2).join(', ')} and ${schemas.length - 2} more`;
	}

	// Start drawer.
	let startOpen = $state(false);
	let name = $state('');
	let format = $state('json');
	let schemas = $state<string[]>([]);
	let statuses = $state<string[]>([]);
	let includeSchemas = $state(false);
	let includeMedia = $state(false);
	let template = $state('');
	function openStart() {
		name = `Export ${new Date().toISOString().slice(0, 10)}`;
		format = 'json';
		schemas = [];
		statuses = [];
		includeSchemas = false;
		includeMedia = false;
		template = '';
		startOpen = true;
	}
	const start = submitter(() => (startOpen = false));

	// Schedule drawer.
	let scheduleOpen = $state(false);
	let schName = $state('');
	let schCron = $state<string>('0 2 * * *');
	let schCustom = $state('');
	let schEnabled = $state(true);
	let schFormat = $state('json');
	let schSchemas = $state<string[]>([]);
	let schStatuses = $state<string[]>([]);
	let schIncludeSchemas = $state(false);
	let schIncludeMedia = $state(false);
	let schTemplate = $state('');
	const cronOptions = [...CRON_PRESETS, { value: 'custom', label: 'A cron expression of my own' }];
	function openSchedule() {
		schName = '';
		schCron = '0 2 * * *';
		schCustom = '';
		schEnabled = true;
		schFormat = 'json';
		schSchemas = [];
		schStatuses = [];
		schIncludeSchemas = false;
		schIncludeMedia = false;
		schTemplate = '';
		scheduleOpen = true;
	}
	const createSchedule = submitter(() => (scheduleOpen = false));

	function removeSchedule(s: ExportSchedule): SubmitFunction {
		return async ({ cancel }) => {
			const ok = await confirmDialog(
				`Delete the schedule ${s.name}?`,
				'It stops starting exports. The exports it already started stay in the list.',
				{ confirmLabel: 'Delete' },
			);
			if (!ok) cancel();
			return async ({ update }) => update();
		};
	}
</script>

<PageTitle title="Data export" />

<PageShell
	title="Data export"
	description="Exports that have run, what a running one is doing, and the schedules that start them."
	width="wide"
>
	{#snippet actions()}
		<Button variant="secondary" size="sm" onclick={refresh} loading={refreshing}>
			<RefreshCw size={ICON.sm} /> Refresh
		</Button>
		{#if data.gate.state === 'ok'}
			<Button variant="primary" size="sm" onclick={openStart}>
				<Plus size={ICON.sm} /> New export
			</Button>
		{/if}
	{/snippet}

	{#if data.gate.state !== 'ok'}
		<GateNotice
			gate={data.gate}
			title="Data export"
			absent="The data export plugin is not part of this build, so nothing can be exported from here."
		/>
	{:else}
		<FormErrors message={form?.error} />
		{#if form?.started}
			<Alert tone="success" autoDismiss>
				Export started. It runs in the background, and the list below follows it until it finishes.
			</Alert>
		{/if}
		{#if form?.canceled}
			<Alert tone="brand" autoDismiss>Export canceled. It wrote no file.</Alert>
		{/if}
		{#if form?.scheduled}
			<Alert tone="success" autoDismiss>Schedule created.</Alert>
		{/if}

		<div class="grid gap-4 sm:grid-cols-3">
			<Stat size="sm" mono label="Exports" value={formatCount(data.total)} />
			<Stat size="sm" mono label="Running" value={formatCount(running.length)} />
			<Stat
				size="sm"
				mono
				label="Failed"
				value={formatCount(failed)}
				tone={failed > 0 ? 'danger' : undefined}
			/>
		</div>

		<section class="flex flex-col gap-4">
			<div class="flex flex-wrap items-center justify-between gap-2">
				<SectionHeading level={2}>Exports</SectionHeading>
				{#if running.length > 0}
					<p class="flex items-center gap-2 text-xs text-muted" role="status">
						<Spinner size={ICON.xs} />
						{running.length === 1 ? 'One export is running.' : `${running.length} exports are running.`}
						This list follows it until it finishes.
					</p>
				{/if}
			</div>

			{#if data.jobs.length === 0}
				<EmptyState
					title="Nothing has been exported"
					description="Start an export with New export. It runs in the background and appears here while it works."
				>
					{#snippet iconSnippet()}
						<Download size={ICON.lg} />
					{/snippet}
				</EmptyState>
			{:else}
				<ListToolbar label="Filter exports">
					{#snippet search()}
						<SearchInput
							id="export-narrow"
							bind:value={narrow}
							placeholder="Name, format or status on this page"
						/>
					{/snippet}
				</ListToolbar>

				<Table label="Exports">
					<thead>
						<tr>
							<th scope="col">Name</th>
							<th scope="col">What</th>
							<th scope="col">Status</th>
							<th scope="col">Entries</th>
							<th scope="col">Size</th>
							<th scope="col" class="text-right">Actions</th>
						</tr>
					</thead>
					<tbody>
						{#each visible as job (job.id)}
							<tr>
								<td>
									{job.name}
									<div class="text-xs text-faint">{formatDateTime(job.created_at)}</div>
								</td>
								<td>
									<span class="text-sm">{FORMAT_LABELS[job.format]?.label ?? job.format}</span>
									<div class="text-xs text-faint">
										{scopeText(job.filter?.schemas)}{job.include_schemas ? ', with definitions' : ''}
									</div>
								</td>
								<td class="min-w-48">
									<div class="flex flex-col gap-1">
										<div class="flex items-center gap-2">
											<Badge tone={jobTone(job.status)}>{job.status}</Badge>
											{#if !active(job)}
												<span class="text-xs text-muted">{stageText(job)}</span>
											{/if}
										</div>
										{#if active(job)}
											<!-- The step is the bar's name, so a reader hears what the
											     export is doing along with how far it got. -->
											<Progress
												value={Math.round(jobProgress(job) * 100)}
												size="sm"
												label={stageText(job)}
												animated={job.rows_total === 0}
											/>
										{/if}
										{#if job.error}
											<div class="text-xs text-danger">{job.error}</div>
										{/if}
									</div>
								</td>
								<td data-cell="nowrap" class="text-xs">
									{formatCount(job.status === 'completed' ? job.rows_written : job.rows_processed)}
									{#if job.rows_total > 0}<span class="text-faint"> of {formatCount(job.rows_total)}</span>{/if}
								</td>
								<td data-cell="nowrap" class="text-xs"
									>{job.file_size > 0 ? fileSize(job.file_size) : NO_VALUE}</td
								>
								<td>
									<div class="flex items-center justify-end gap-2">
										{#if downloadable(job)}
											<Button
												variant="ghost"
												size="sm"
												href={downloadHref(job.id)}
												aria-label="Download {job.name}"
											>
												<Download size={ICON.sm} />
											</Button>
										{/if}
										{#if active(job)}
											<form method="post" action="?/cancel" use:enhance>
												<input type="hidden" name="id" value={job.id} />
												<Button variant="ghost" size="sm" type="submit" aria-label="Cancel {job.name}">
													<X size={ICON.sm} />
												</Button>
											</form>
										{/if}
									</div>
								</td>
							</tr>
						{/each}
					</tbody>
				</Table>
				<Pagination
					page={pageNumber(data.offset, data.limit)}
					perPage={data.limit}
					count={data.jobs.length}
					total={data.total ?? undefined}
					noun="exports"
					href={pageHref('/admin/data-export', data.limit)}
				/>

				{#if visible.length === 0}
					<EmptyState title="Nothing on this page matches" description="Clear the filter to see the rest.">
						{#snippet iconSnippet()}
							<Search size={ICON.lg} />
						{/snippet}
					</EmptyState>
				{/if}
			{/if}
		</section>

		<section class="flex flex-col gap-4">
			<div class="flex flex-wrap items-center justify-between gap-2">
				<SectionHeading level={2}>Schedules</SectionHeading>
				<Button variant="secondary" size="sm" onclick={openSchedule}>
					<Plus size={ICON.sm} /> New schedule
				</Button>
			</div>
			{#if data.schedules.length === 0}
				<EmptyState
					title="No recurring export"
					description="A schedule starts an export on a timetable, in UTC, and each run appears in the list above."
				>
					{#snippet iconSnippet()}
						<CalendarClock size={ICON.lg} />
					{/snippet}
				</EmptyState>
			{:else}
				<Table label="Schedules">
					<thead>
						<tr>
							<th scope="col">Name</th>
							<th scope="col">When</th>
							<th scope="col">What</th>
							<th scope="col">State</th>
							<th scope="col">Last run</th>
							<th scope="col">Next run</th>
							<th scope="col" class="text-right">Actions</th>
						</tr>
					</thead>
					<tbody>
						{#each data.schedules as schedule (schedule.id)}
							<tr>
								<td data-cell="nowrap">{schedule.name}</td>
								<td>
									{cronLabel(schedule.cron_expression)}
									<div class="font-mono text-xs text-faint">{schedule.cron_expression}</div>
								</td>
								<td class="text-xs">
									{schedule.export_config
										? `${FORMAT_LABELS[schedule.export_config.format]?.label ?? schedule.export_config.format}, ${scopeText(schedule.export_config.filter?.schemas)}`
										: NO_VALUE}
								</td>
								<td data-cell="nowrap">
									<Badge tone={schedule.enabled ? 'success' : 'neutral'} dot>
										{scheduleState(schedule)}
									</Badge>
								</td>
								<td data-cell="nowrap" class="text-xs text-faint"
									>{schedule.last_run_at ? formatDateTime(schedule.last_run_at) : NO_VALUE}</td
								>
								<td data-cell="nowrap" class="text-xs text-faint">
									{schedule.enabled && schedule.next_run_at
										? formatDateTime(schedule.next_run_at)
										: NO_VALUE}
								</td>
								<td>
									<div class="flex items-center justify-end gap-2">
										<form method="post" action="?/toggleSchedule" use:enhance>
											<input type="hidden" name="id" value={schedule.id} />
											<input type="hidden" name="enabled" value={schedule.enabled ? 'false' : 'true'} />
											<Button
												variant="ghost"
												size="sm"
												type="submit"
												aria-label="{schedule.enabled ? 'Pause' : 'Resume'} {schedule.name}"
											>
												{#if schedule.enabled}<Pause size={ICON.sm} />{:else}<Play size={ICON.sm} />{/if}
											</Button>
										</form>
										<form method="post" action="?/deleteSchedule" use:enhance={removeSchedule(schedule)}>
											<input type="hidden" name="id" value={schedule.id} />
											<Button variant="ghost" size="sm" type="submit" aria-label="Delete {schedule.name}">
												<Trash2 size={ICON.sm} class="text-danger" />
											</Button>
										</form>
									</div>
								</td>
							</tr>
						{/each}
					</tbody>
				</Table>
			{/if}
		</section>
	{/if}
</PageShell>

<Drawer
	bind:open={startOpen}
	title="New export"
	description="The export runs in the background. This page follows it and offers the file when it finishes."
>
	<form id="start-export-form" method="post" action="?/start" use:enhance={start.enhance}>
		<div class="flex flex-col gap-4">
			<Input id="export-name" name="name" label="Name" bind:value={name} required />
			<ExportConfigFields
				idPrefix="export"
				schemaNames={data.schemas}
				bind:format
				bind:schemas
				bind:statuses
				bind:includeSchemas
				bind:includeMedia
				bind:template
			/>
		</div>
	</form>
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (startOpen = false)}>Cancel</Button>
		<Button variant="primary" type="submit" form="start-export-form" loading={start.pending}>Start</Button>
	{/snippet}
</Drawer>

<Drawer
	bind:open={scheduleOpen}
	title="New schedule"
	description="Starts the same export on a timetable, in UTC. A run that falls behind runs once, not once per missed time."
>
	<form id="schedule-form" method="post" action="?/createSchedule" use:enhance={createSchedule.enhance}>
		<div class="flex flex-col gap-4">
			<Input id="schedule-name" name="name" label="Name" bind:value={schName} required />
			<Select
				id="schedule-when"
				label="When"
				bind:value={schCron}
				options={cronOptions}
			/>
			{#if schCron === 'custom'}
				<Input
					id="schedule-cron"
					label="Cron expression"
					hint="Five fields (minute hour day month weekday), or @hourly, @daily, @weekly, @monthly, @every 6h."
					mono
					bind:value={schCustom}
					required
				/>
			{/if}
			<input type="hidden" name="cron_expression" value={schCron === 'custom' ? schCustom : schCron} />
			<ExportConfigFields
				idPrefix="schedule"
				schemaNames={data.schemas}
				bind:format={schFormat}
				bind:schemas={schSchemas}
				bind:statuses={schStatuses}
				bind:includeSchemas={schIncludeSchemas}
				bind:includeMedia={schIncludeMedia}
				bind:template={schTemplate}
			/>
			<input type="hidden" name="enabled" value={schEnabled ? 'true' : 'false'} />
			<Toggle id="schedule-enabled" label="Run on the timetable" bind:checked={schEnabled} />
		</div>
	</form>
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (scheduleOpen = false)}>Cancel</Button>
		<Button variant="primary" type="submit" form="schedule-form" loading={createSchedule.pending}>
			Create
		</Button>
	{/snippet}
</Drawer>
