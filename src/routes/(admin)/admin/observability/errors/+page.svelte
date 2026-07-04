<script lang="ts">
	import PageTitle from '$lib/components/PageTitle.svelte';
	import {
		Alert,
		Badge,
		Button,
		EmptyState,
		Input,
		Modal,
		PageShell,
		SectionHeading,
		SegmentedControl,
		Stat,
		Table,
		toast,
		Pagination,
	} from '@lyeve-labs/ui-kit';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import FormErrors from '$lib/components/FormErrors.svelte';
	import ListToolbar from '$lib/components/ListToolbar.svelte';
	import OlderHidden from '$lib/components/OlderHidden.svelte';
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { BellRing, BugOff, CheckCheck, CircleCheck, EyeOff, RotateCcw, UserPlus } from '@lucide/svelte';
	import {
		alertStatus,
		count,
		firstSeenWithin,
		severityTone,
		sourceLabel,
		stillFiring,
		triageFor,
		triageOrder,
		unacknowledged,
		type AlertStatus,
		type ErrorAlert,
		type TriageAction,
	} from '$lib/api/error-tracking';
	import { formRefusal } from '$lib/api/refusal';
	import { formatDateTime } from '$lib/format';
	import type { ActionData, PageData } from './$types';
	import { pageHref, pageNumber } from '$lib/api/list';
	import { ICON } from '$lib/icon';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const formError = $derived((form as { error?: string } | null)?.error ?? '');
	const refused = $derived(formRefusal(form));
	const open = $derived(unacknowledged(data.alerts));
	const fresh = $derived(firstSeenWithin(data.alerts, 24));
	const ordered = $derived(triageOrder(data.alerts));

	const bySeverity = $derived(
		new Map(data.codes.map((c) => [c.id, { severity: c.severity, title: c.title }])),
	);

	const STATUS_LABEL: Record<AlertStatus, string> = { open: 'Open', resolved: 'Resolved', ignored: 'Ignored' };
	const STATUS_TONE: Record<AlertStatus, 'danger' | 'success' | 'neutral'> = {
		open: 'danger',
		resolved: 'success',
		ignored: 'neutral',
	};
	const TRIAGE_LABEL: Record<TriageAction, string> = { resolve: 'Resolve', ignore: 'Ignore', reopen: 'Reopen' };
	const TRIAGE_DONE: Record<TriageAction, string> = { resolve: 'Resolved', ignore: 'Ignored', reopen: 'Reopened' };

	// Link segments: the filter is the plugin's, so the page reloads with it in
	// the address and the choice survives a refresh and a share.
	const base = '/admin/observability/errors';
	const statusOptions = [
		{ value: '', label: 'All', href: base },
		{ value: 'open', label: 'Open', href: `${base}?status=open` },
		{ value: 'resolved', label: 'Resolved', href: `${base}?status=resolved` },
		{ value: 'ignored', label: 'Ignored', href: `${base}?status=ignored` },
	];

	function ack(): SubmitFunction {
		return () =>
			async ({ result, update }) => {
				await update();
				if (result.type === 'success') toast.success('Acknowledged');
			};
	}

	function moved(action: TriageAction): SubmitFunction {
		return () =>
			async ({ result, update }) => {
				await update();
				if (result.type === 'success') toast.success(TRIAGE_DONE[action]);
			};
	}

	// Assigning is a one-field prompt over the list.
	let assigning = $state<ErrorAlert | null>(null);
	let assignee = $state('');
	let assignPending = $state(false);

	function openAssign(a: ErrorAlert) {
		assigning = a;
		assignee = a.assigned_to ?? '';
	}

	const assignSubmit: SubmitFunction = () => {
		assignPending = true;
		return async ({ result, update }) => {
			assignPending = false;
			if (result.type === 'success') {
				assigning = null;
				toast.success(assignee ? `Assigned to ${assignee}` : 'Assignee cleared');
			}
			await update();
		};
	};
</script>

<PageTitle title="Errors" />

<PageShell
	title="Errors"
	description="Distinct failures the engine has recorded, grouped by where they came from."
	width="wide"
	back={{ href: '/admin/observability', label: 'Observability' }}
>
	{#snippet actions()}
		{#if data.gate.state === 'ok'}
			<Button variant="secondary" size="sm" href="/admin/observability/errors/alerts">
				<BellRing size={ICON.sm} /> Spike alerts
			</Button>
		{/if}
	{/snippet}

	{#if data.gate.state !== 'ok'}
		<GateNotice
			gate={data.gate}
			title="Errors"
			absent="The error tracking plugin is not part of this build, so failures are logged and not grouped."
		/>
	{:else}
		{#if !assigning}
			<FormErrors message={formError} {refused} />
		{/if}

		<div class="grid gap-4 sm:grid-cols-3">
			<!-- Distinct failures, not events. Ten thousand events from one
			     fingerprint is one problem. Ten fingerprints with one event
			     each is ten, and a count of events says the opposite. -->
			<Stat
				size="sm"
				mono
				label="Unacknowledged failures"
				value={open.length}
				tone={open.length > 0 ? 'danger' : 'neutral'}
			/>
			<Stat size="sm" mono label="New in the last day" value={fresh.length} />
			<Stat size="sm" mono label="Distinct failures tracked" value={data.alerts.length} />
		</div>
		<p class="text-xs text-muted">
			Each row is a group of errors that share a source location, not a single occurrence.
		</p>

		<section class="flex flex-col gap-4">
			<SectionHeading level={2}>Failures</SectionHeading>
			<ListToolbar label="Filter failures">
				{#snippet filters()}
					<SegmentedControl label="Status" labelHidden value={data.status} options={statusOptions} />
				{/snippet}
			</ListToolbar>
			{#if data.alerts.length === 0}
				<EmptyState
					title={data.status ? `No ${STATUS_LABEL[data.status as AlertStatus].toLowerCase()} failures` : 'Nothing has failed'}
					description={data.status
						? 'No failure has this status. Widen the filter to see the rest.'
						: 'No error has been recorded, which on a running instance is worth believing only if traffic has reached it.'}
				>
					{#snippet iconSnippet()}
						<BugOff size={ICON.lg} />
					{/snippet}
				</EmptyState>
			{:else}
				<Table label="Failures">
					<thead>
						<tr>
							<th scope="col">Failure</th>
							<th scope="col">Status</th>
							<th scope="col">Severity</th>
							<th scope="col">Seen</th>
							<th scope="col">Last</th>
							<th scope="col"><span class="sr-only">Actions</span></th>
						</tr>
					</thead>
					<tbody>
						{#each ordered as a (a.id)}
							{@const status = alertStatus(a)}
							<tr data-testid="failure-row" data-status={status}>
								<td>
									<div class="flex items-center gap-2">
										<span class="font-medium text-fg">
											{bySeverity.get(a.error_code_id)?.title ?? 'Unclassified failure'}
										</span>
										{#if status === 'open' && stillFiring(a)}
											<!-- An acknowledged alert still firing is seen,
											     not resolved. Hiding it would hide a live
											     outage somebody ticked off an hour ago. -->
											<Badge tone="danger" dot>Still happening</Badge>
										{/if}
										{#if a.acknowledged}
											<Badge tone="neutral">Acknowledged</Badge>
										{/if}
									</div>
									<div class="max-w-lg truncate text-xs text-faint" title={a.message_sample}>
										{a.message_sample}
									</div>
									<div class="font-mono text-xs text-faint">{sourceLabel(a)}</div>
									{#if a.assigned_to}
										<div class="text-xs text-muted" data-testid="assignee">Assigned to {a.assigned_to}</div>
									{/if}
								</td>
								<td data-cell="nowrap">
									<Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>
								</td>
								<td data-cell="nowrap">
									<Badge tone={severityTone(bySeverity.get(a.error_code_id)?.severity ?? '')}>
										{bySeverity.get(a.error_code_id)?.severity ?? 'Unknown'}
									</Badge>
								</td>
								<td data-cell="nowrap" class="font-mono text-xs">{count(a.error_count)}</td>
								<td data-cell="nowrap" class="text-xs text-faint">
									{formatDateTime(a.last_seen)}
								</td>
								<td data-cell="nowrap">
									<div class="flex items-center justify-end gap-1">
										{#if !a.acknowledged}
											<form method="POST" action="?/acknowledge" use:enhance={ack()}>
												<input type="hidden" name="id" value={a.id} />
												<Button
													variant="ghost"
													size="sm"
													type="submit"
													aria-label="Acknowledge this failure"
													title="Acknowledge"
												>
													<CheckCheck size={ICON.sm} />
												</Button>
											</form>
										{/if}
										{#each triageFor(status) as action (action)}
											<form method="POST" action="?/triage" use:enhance={moved(action)}>
												<input type="hidden" name="id" value={a.id} />
												<input type="hidden" name="action" value={action} />
												<Button
													variant="ghost"
													size="sm"
													type="submit"
													aria-label="{TRIAGE_LABEL[action]} this failure"
													title={TRIAGE_LABEL[action]}
												>
													{#if action === 'resolve'}
														<CircleCheck size={ICON.sm} />
													{:else if action === 'ignore'}
														<EyeOff size={ICON.sm} />
													{:else}
														<RotateCcw size={ICON.sm} />
													{/if}
												</Button>
											</form>
										{/each}
										<Button
											variant="ghost"
											size="sm"
											aria-label="Assign this failure"
											title="Assign"
											onclick={() => openAssign(a)}
										>
											<UserPlus size={ICON.sm} />
										</Button>
									</div>
								</td>
							</tr>
						{/each}
					</tbody>
				</Table>
				<Pagination
					page={pageNumber(data.offset, data.limit)}
					perPage={data.limit}
					count={data.alerts.length}
					total={data.total ?? undefined}
					noun="alerts"
					href={pageHref(base, data.limit, data.status ? { status: data.status } : {})}
				/>
				<p class="text-xs text-muted">
					Ordered for triage: unacknowledged first, then whatever is still happening, then by
					how recently it last did. A resolved failure opens again when it next occurs. An ignored
					one stays ignored.
				</p>
			{/if}
		</section>

		<section class="flex flex-col gap-4" aria-label="Recent events">
			<SectionHeading level={2}>Recent events</SectionHeading>
			{#if data.events === null}
				<Alert tone="warn">The events could not be read. This is not a report that none have happened.</Alert>
			{:else}
				{#if data.events.data.length === 0}
					<p class="text-sm text-muted">No event in the window this instance reads.</p>
				{:else}
					<Table label="Recent events">
						<thead>
							<tr>
								<th scope="col">When</th>
								<th scope="col">Endpoint</th>
								<th scope="col">Status</th>
								<th scope="col">Message</th>
							</tr>
						</thead>
						<tbody>
							{#each data.events.data as e (e.id)}
								<tr data-testid="event-row">
									<td data-cell="nowrap" class="text-xs text-faint">{formatDateTime(e.ts)}</td>
									<td class="font-mono text-xs">{e.endpoint}</td>
									<td data-cell="nowrap" class="font-mono text-xs">{e.http_status}</td>
									<td class="max-w-lg truncate text-xs text-muted" title={e.message}>{e.message}</td>
								</tr>
							{/each}
						</tbody>
					</Table>
				{/if}
				{#if data.events.hiddenOlder > 0}
					<OlderHidden count={data.events.hiddenOlder} noun="events" windowDays={data.events.windowDays} />
				{/if}
			{/if}
		</section>
	{/if}
</PageShell>

{#if assigning}
	<Modal open title="Assign this failure" onclose={() => (assigning = null)}>
		<form method="POST" action="?/assign" id="assign-form" use:enhance={assignSubmit} class="flex flex-col gap-3">
			<FormErrors message={formError} {refused} />
			<input type="hidden" name="id" value={assigning.id} />
			<Input
				id="alert-assignee"
				name="assignee"
				label="Assignee"
				hint="A name, an email or a user id. Leave it empty to clear the assignee."
				bind:value={assignee}
				autocomplete="off"
			/>
		</form>
		{#snippet footer()}
			<Button variant="secondary" onclick={() => (assigning = null)}>Cancel</Button>
			<Button variant="primary" type="submit" form="assign-form" loading={assignPending}>Save</Button>
		{/snippet}
	</Modal>
{/if}
