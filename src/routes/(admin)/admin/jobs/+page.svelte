<script lang="ts">
	import PageTitle from '$lib/components/PageTitle.svelte';
	import {
		Badge,
		Button,
		CopyField,
		Drawer,
		EmptyState,
		Input,
		Modal,
		NumberInput,
		PageShell,
		Pagination,
		SearchInput,
		SegmentedControl,
		Table,
		Textarea,
		Toggle,
		confirm as confirmDialog,
		toast,
	} from '@lyeve-labs/ui-kit';
	import type { PageData, ActionData } from './$types';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Plus, Trash2, Pencil, Clock, CheckCircle, XCircle, Inbox } from '@lucide/svelte';
	import type { Job } from './+page.server';
	import ListToolbar from '$lib/components/ListToolbar.svelte';
	import { submitter } from '$lib/forms.svelte';
	import FormErrors from '$lib/components/FormErrors.svelte';
	import { formRefusal } from '$lib/api/refusal';
	import { ALERT_PREFIX, hasChannels } from '$lib/api/cron-alerts';
	import AlertChannelFields from '$lib/components/AlertChannelFields.svelte';
	import { formatDateTime } from '$lib/format';
	import { narrows } from '$lib/narrow';
	import { pageHref, pageNumber } from '$lib/api/list';
	import { ICON } from '$lib/icon';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const submit = submitter(closeDrawer);

	/*
	 * The list is one page of the collection and the endpoint states no total, so
	 * a subtitle that counted jobs would claim the page is all of them. It names
	 * the feature instead and the pager states the range.
	 */
	const description = 'HTTP jobs on cron schedules.';

	// One drawer for both writes: a null target is a new job.
	let open = $state(false);
	let editing = $state<Job | null>(null);
	let enabled = $state(true);
	let payload = $state('');
	let threshold = $state(1);

	const refused = $derived(formRefusal(form));

	// The alert webhook's signing secret arrives once, in the answer to the
	// write that set the URL.
	let reveal = $state<{ name: string; secret: string } | null>(null);
	$effect(() => {
		if (form && 'signingSecret' in form && typeof form.signingSecret === 'string' && form.signingSecret) {
			reveal = { name: String(form.signingFor ?? ''), secret: form.signingSecret };
		}
	});
	const formError = $derived(form && 'error' in form && form.error ? String(form.error) : undefined);

	function openCreate() {
		editing = null;
		enabled = true;
		payload = '';
		threshold = 1;
		open = true;
	}

	function openEdit(job: Job) {
		editing = job;
		enabled = job.enabled;
		payload = job.payload ? JSON.stringify(job.payload, null, 2) : '';
		threshold = job.alerts?.failure_threshold ?? 1;
		open = true;
	}

	// The address can name the drawer, and the dashboard's alerts link to it
	// that way.
	$effect(() => {
		if (data.openJob) openEdit(data.openJob);
		else if (data.openNew) openCreate();
	});

	// Closing takes the query out of the address, or the next load would open
	// the drawer again on a job the reader had just put away.
	function closeDrawer() {
		open = false;
		if (page.url.searchParams.has('edit') || page.url.searchParams.has('new')) {
			void goto('/admin/jobs', { replaceState: true, noScroll: true, keepFocus: true });
		}
	}

	/**
	 * The question names the job, so it is tied to a row by more than which
	 * button was pressed. enhance awaits this before it sends anything, so
	 * canceling here means the request is never made.
	 */
	function deleteJob(name: string): SubmitFunction {
		return async ({ cancel }) => {
			const confirmed = await confirmDialog(
				`Delete ${name}?`,
				'Its schedule stops and its run history goes with it.',
				{ confirmLabel: 'Delete' }
			);
			if (!confirmed) {
				cancel();
				return;
			}
			return async ({ result, update }) => {
				await update();
				if (result.type === 'success') toast.success(`Deleted ${name}`);
			};
		};
	}

	function formatDate(iso: string | null) {
		return formatDateTime(iso, 'Never');
	}

	// The endpoint takes no search, so the box narrows the page on screen and
	// the pager below still walks the whole collection.
	let query = $state('');
	let status = $state('');
	const STATUSES = [
		{ value: '', label: 'All' },
		{ value: 'enabled', label: 'Enabled' },
		{ value: 'disabled', label: 'Disabled' },
	];
	const visible = $derived(
		data.jobs.filter(
			(j) =>
				narrows(query, j.name, j.description, j.schedule, j.endpoint) &&
				(status === '' || (status === 'enabled') === j.enabled)
		)
	);
</script>

<PageTitle title="Scheduled jobs" />

<PageShell title="Scheduled jobs" {description} width="wide">
	{#snippet actions()}
		<Button variant="primary" size="sm" onclick={openCreate}>
			<Plus size={ICON.sm} /> New job
		</Button>
	{/snippet}

	{#if !open}
		<FormErrors message={formError} {refused} />
	{/if}

	{#if data.jobs.length === 0}
		<EmptyState title="No jobs yet" description="Schedule HTTP jobs to run on a cron expression.">
			{#snippet iconSnippet()}
				<Inbox size={ICON.lg} />
			{/snippet}
			{#snippet action()}
				<Button variant="secondary" onclick={openCreate}>
					<Plus size={ICON.sm} /> New job
				</Button>
			{/snippet}
		</EmptyState>
	{:else}
		<ListToolbar label="Filter jobs">
			{#snippet search()}
				<label for="job-search" class="sr-only">Narrow this page</label>
				<SearchInput id="job-search" bind:value={query} placeholder="Name, schedule or endpoint on this page" />
			{/snippet}
			{#snippet filters()}
				<SegmentedControl label="Status" labelHidden bind:value={status} options={STATUSES} />
			{/snippet}
		</ListToolbar>

		{#if visible.length === 0}
			<EmptyState title="No job on this page matches" description="Clear the search, or turn the page: the box narrows what is on screen." />
		{:else}
		<Table label="Scheduled jobs">
			<thead>
				<tr>
					<th scope="col">Name</th>
					<th scope="col">Schedule</th>
					<th scope="col">Endpoint</th>
					<th scope="col">Status</th>
					<th scope="col">Last run</th>
					<th scope="col" class="text-right">Actions</th>
				</tr>
			</thead>
			<tbody>
				{#each visible as job (job.id)}
					<tr>
						<td>
							<p class="font-medium text-fg">{job.name}</p>
							{#if job.description}
								<p class="mt-0.5 text-xs text-faint">{job.description}</p>
							{/if}
						</td>
						<td data-cell="nowrap" class="font-mono text-xs text-muted">{job.schedule}</td>
						<td class="max-w-48 truncate font-mono text-xs text-faint">{job.endpoint}</td>
						<td>
							{#if job.enabled}
								<Badge tone="success" dot>Enabled</Badge>
							{:else}
								<Badge tone="neutral" dot>Disabled</Badge>
							{/if}
						</td>
						<td data-cell="nowrap">
							<div class="flex items-center gap-1.5 text-xs text-faint">
								{#if job.last_status === 'ok'}
									<CheckCircle size={ICON.xs} class="shrink-0 text-success" />
								{:else if job.last_status === 'error'}
									<XCircle size={ICON.xs} class="shrink-0 text-danger" />
								{:else}
									<Clock size={ICON.xs} class="shrink-0" />
								{/if}
								{formatDate(job.last_run_at)}
							</div>
						</td>
						<td>
							<div class="flex items-center justify-end gap-2">
								<Button
									variant="ghost"
									size="sm"
									aria-label="Edit {job.name}"
									onclick={() => openEdit(job)}
								>
									<Pencil size={ICON.sm} />
								</Button>
								<form
									method="POST"
									action="?/delete"
									use:enhance={deleteJob(job.name)}
								>
									<input type="hidden" name="id" value={job.id} />
									<Button
										variant="ghost"
										size="sm"
										type="submit"
										aria-label="Delete {job.name}"
									>
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

		<!-- The endpoint states no total, so the range comes from the rows on
		     screen: without the count the summary could only name the page. -->
		<Pagination
			page={pageNumber(data.offset, data.limit)}
			perPage={data.limit}
			count={data.jobs.length}
			hasNext={data.hasMore}
			noun="jobs"
			href={pageHref('/admin/jobs', data.limit)}
		/>
	{/if}
</PageShell>

{#if reveal}
	<Modal open title="Alert signing secret" onclose={() => (reveal = null)}>
		<div class="flex flex-col gap-3">
			<p class="text-sm text-fg">
				{reveal.name} signs every failure alert it sends to its webhook with this secret. Copy it to the receiver now. It is not shown again.
			</p>
			<CopyField value={reveal.secret} label="Signing secret" mono secret />
		</div>
		{#snippet footer()}
			<Button variant="secondary" onclick={() => (reveal = null)}>Close</Button>
		{/snippet}
	</Modal>
{/if}

<Drawer bind:open title={editing ? `Edit ${editing.name}` : 'New job'} onclose={closeDrawer}>
	<form
		method="POST"
		action={editing ? '?/update' : '?/create'}
		id="job-form"
		use:enhance={submit.enhance}
		class="flex flex-col gap-4"
	>
		<FormErrors message={formError} {refused} />
		{#if editing}<input type="hidden" name="id" value={editing.id} />{/if}

		<Input id="job-name" label="Name" name="name" required placeholder="send-daily-digest" value={editing?.name ?? ''} />
		<Input
			id="job-description"
			label="Description"
			name="description"
			placeholder="Sends the daily digest email"
			value={editing?.description ?? ''}
		/>
		<Input
			id="job-schedule"
			label="Cron schedule"
			name="schedule"
			required
			placeholder="0 9 * * *"
			hint="Standard cron expression, for example 0 9 * * * for 9 AM daily"
			value={editing?.schedule ?? ''}
		/>
		<Input
			id="job-endpoint"
			label="Endpoint URL"
			name="endpoint"
			type="url"
			required
			placeholder="https://example.com/api/trigger"
			value={editing?.endpoint ?? ''}
		/>
		<Textarea
			id="job-payload"
			label="JSON payload (optional)"
			name="payload"
			rows={4}
			placeholder={'{\n  "key": "value"\n}'}
			bind:value={payload}
		/>
		<!-- Toggle is a switch button rather than a form control, so the value
		     reaches the action through a field of its own. -->
		<div>
			<input type="hidden" name="enabled" value={enabled ? 'on' : 'off'} />
			<Toggle id="job-enabled" bind:checked={enabled} label="Enabled" hint="Job will run on schedule when enabled" />
		</div>

		<fieldset class="flex flex-col gap-4 border-t border-line pt-4">
			<legend class="text-sm font-medium text-fg">Failure alerts</legend>
			<p class="text-xs text-muted">
				Where to say a job is failing, and again when it recovers. Leave every channel empty to send none. Email is on every install.
			</p>
			<input type="hidden" name="alerts_stored" value={hasChannels(editing?.alerts) ? 'true' : 'false'} />
			<AlertChannelFields prefix={ALERT_PREFIX} idPrefix="job-alert" value={editing?.alerts ?? null} />
			<NumberInput
				id="job-alert-threshold"
				label="Alert after this many failures in a row"
				name="alert_threshold"
				min={1}
				bind:value={threshold}
			/>
		</fieldset>
	</form>
	{#snippet footer()}
		<Button variant="secondary" onclick={closeDrawer}>Cancel</Button>
		<Button variant="primary" type="submit" form="job-form" loading={submit.pending}>{editing ? 'Save' : 'Create'}</Button>
	{/snippet}
</Drawer>
