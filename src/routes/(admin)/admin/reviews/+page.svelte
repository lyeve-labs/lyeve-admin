<script lang="ts">
	import PageTitle from '$lib/components/PageTitle.svelte';
	import FormErrors from '$lib/components/FormErrors.svelte';
	import NotEnabled from '$lib/components/NotEnabled.svelte';
	import {
		Alert,
		Badge,
		Button,
		Card,
		Drawer,
		EmptyState,
		Input,
		NumberInput,
		PageShell,
		SectionHeading,
		SegmentedControl,
		Select,
		Pagination,
		Table,
		Toggle,
		confirm as confirmDialog,
	} from '@lyeve-labs/ui-kit';
	import { enhance } from '$app/forms';
	import { ArrowDown, ArrowUp, ClipboardCheck, Plus, Trash2, X } from '@lucide/svelte';
	import type { ActionData, PageData } from './$types';
	import ListToolbar from '$lib/components/ListToolbar.svelte';
	import { submitter, fieldErrors } from '$lib/forms.svelte';
	import { REVIEW_STATUSES, approvalsNeeded, conditionText, type ReviewStage, type ReviewStatus } from '$lib/api/review';
	import RefusalNotice from '$lib/components/RefusalNotice.svelte';
	import { formRefusal, type Refusal } from '$lib/api/refusal';
	import { formatDateTime, NO_VALUE } from '$lib/format';
	import { shortId } from '$lib/utils/entry-identity';
	import { pageNumber, pageOffset } from '$lib/api/list';
	import { ICON } from '$lib/icon';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const submit = submitter(() => (open = false));

	const STATUS_LABEL: Record<ReviewStatus, string> = {
		draft: 'Draft',
		pending_review: 'Pending review',
		in_review: 'In review',
		changes_requested: 'Changes requested',
		approved: 'Approved',
		rejected: 'Rejected',
		published: 'Published',
	};
	const STATUS_TONE: Record<ReviewStatus, 'neutral' | 'brand' | 'success' | 'warn' | 'danger'> = {
		draft: 'neutral',
		pending_review: 'brand',
		in_review: 'brand',
		changes_requested: 'warn',
		approved: 'success',
		rejected: 'danger',
		published: 'success',
	};

	// Link segments: the filter is the engine's, so the page reloads with it
	// in the URL and the choice survives a refresh and a share.
	const statusOptions = [
		{ value: '', label: 'All', href: '/admin/reviews' },
		...REVIEW_STATUSES.filter((s) => s !== 'draft').map((s) => ({
			value: s,
			label: STATUS_LABEL[s],
			href: `/admin/reviews?status=${s}`,
		})),
	];

	let byDefinition = $derived(new Map(data.definitions.map((row) => [row.definition.id, row])));

	function stageName(definitionId: string, stageId: string): string {
		const row = byDefinition.get(definitionId);
		return row?.stages.find((s) => s.id === stageId)?.name ?? shortId(stageId);
	}

	function definitionName(definitionId: string): string {
		return byDefinition.get(definitionId)?.definition.name ?? shortId(definitionId);
	}

	function entryHref(definitionId: string, entryId: string): string | null {
		const schema = byDefinition.get(definitionId)?.definition.content_schema;
		return schema ? `/admin/content/${encodeURIComponent(schema)}/${encodeURIComponent(entryId)}` : null;
	}

	function overdue(a: { status: ReviewStatus; overdue: boolean; due_at: string | null }): boolean {
		if (a.status === 'approved' || a.status === 'published') return false;
		return a.overdue || (!!a.due_at && new Date(a.due_at).getTime() < Date.now());
	}

	function hours(seconds: number): string {
		return seconds > 0 ? `${Math.round((seconds / 3600) * 10) / 10}h` : NO_VALUE;
	}

	const pageHref = (offset: number) =>
		`/admin/reviews?${new URLSearchParams({ ...(data.status ? { status: data.status } : {}), ...(offset ? { offset: String(offset) } : {}) }).toString()}`.replace(/\?$/, '');

	// What the definitions read says this install allows. The ceiling and the
	// count are the plugin's, so a lifted ceiling never reads as a stale one.
	let limits = $derived(data.limits);
	let workflows = $derived(limits?.workflows ?? null);
	let atCeiling = $derived(!!workflows && workflows.limit !== null && workflows.current >= workflows.limit);
	let ceilingRefusal = $derived<Refusal | null>(
		atCeiling && workflows
			? { kind: 'cap', cap: 'review.workflows', limit: workflows.limit, current: workflows.current, upgradeUrl: '' }
			: null,
	);
	// The paid stage settings. False closes them, null (a plugin that does
	// not say) leaves them open and a refused create says why.
	let stagesLocked = $derived(limits?.licensed === false);
	let refused = $derived(formRefusal(form));
	let formError = $derived(form && 'error' in form && form.error ? String(form.error) : undefined);

	const ESCALATE = [
		{ value: 'none', label: 'Nobody' },
		{ value: 'user', label: 'A user' },
		{ value: 'role', label: 'A role' },
	];
	const OPS = [
		{ value: 'equals', label: 'Is' },
		{ value: 'not_equals', label: 'Is not' },
		{ value: 'in', label: 'One of' },
		{ value: 'exists', label: 'Is set' },
	];

	function stageNotes(stage: ReviewStage): string[] {
		const notes: string[] = [];
		if (approvalsNeeded(stage) > 1) notes.push(`${approvalsNeeded(stage)} approvals`);
		if (stage.escalate_to_role) notes.push(`escalates to ${stage.escalate_to_role}`);
		else if (stage.escalate_to_user_id) notes.push(`escalates to ${shortId(stage.escalate_to_user_id)}`);
		if (stage.condition) notes.push(`when ${conditionText(stage.condition)}`);
		return notes;
	}

	// The create drawer: a name, the schema it reviews, the publish switch and
	// an ordered list of stages serialized into one hidden field.
	type StageRow = {
		key: number;
		name: string;
		required_role: string;
		sla_hours: number;
		quorum: number;
		escalate_kind: string;
		escalate_to: string;
		condition_field: string;
		condition_op: string;
		condition_value: string;
	};
	let open = $state(false);
	let name = $state('');
	let slug = $state('');
	let contentSchema = $state<string | null>('');
	let publishOnApprove = $state(true);
	let nextKey = 1;
	let stages = $state<StageRow[]>([]);

	function blankStage(): StageRow {
		return {
			key: nextKey++,
			name: '',
			required_role: '',
			sla_hours: 0,
			quorum: 1,
			escalate_kind: 'none',
			escalate_to: '',
			condition_field: '',
			condition_op: 'equals',
			condition_value: '',
		};
	}

	function openCreate() {
		name = '';
		slug = '';
		contentSchema = data.schemas[0] ?? '';
		publishOnApprove = true;
		stages = [blankStage()];
		open = true;
	}

	function move(index: number, by: -1 | 1) {
		const to = index + by;
		if (to < 0 || to >= stages.length) return;
		const next = [...stages];
		[next[index], next[to]] = [next[to], next[index]];
		stages = next;
	}

	let stagesJSON = $derived(
		JSON.stringify(
			stages.map((s) => ({
				name: s.name,
				required_role: s.required_role,
				sla_duration_seconds: Math.round(s.sla_hours * 3600),
				quorum: s.quorum,
				escalate_kind: s.escalate_kind,
				escalate_to: s.escalate_to,
				condition_field: s.condition_field,
				condition_op: s.condition_op,
				condition_value: s.condition_value,
			})),
		),
	);
	let schemaOptions = $derived(data.schemas.map((s) => ({ value: s, label: s })));
	let errors = $derived(fieldErrors(form));

	let deleteForm = $state<HTMLFormElement | null>(null);
	let deleteId = $state('');

	async function askDelete(id: string, label: string) {
		const ok = await confirmDialog(
			`Delete ${label}?`,
			'Its assignments, their history and their comments go with it.',
			{ confirmLabel: 'Delete' },
		);
		if (!ok) return;
		deleteId = id;
		await Promise.resolve();
		deleteForm?.requestSubmit();
	}
</script>

<PageTitle title="Reviews" />

<PageShell
	title="Reviews"
	description="Editorial review: the definitions content moves through, and where every entry under review stands."
	width="wide"
>
	{#snippet actions()}
		<Badge tone="violet" size="sm">Beta</Badge>
		{#if data.operator}
			<Button variant="primary" size="sm" onclick={openCreate} disabled={atCeiling}>
				<Plus size={ICON.sm} />
				New definition
			</Button>
		{/if}
	{/snippet}

	{#if !open && (formError || refused)}
		<FormErrors message={formError} {refused} />
	{:else if form && 'created' in form && form.created}
		<Alert tone="success" autoDismiss>Definition created.</Alert>
	{:else if form && 'deleted' in form && form.deleted}
		<Alert tone="success" autoDismiss>Definition deleted.</Alert>
	{/if}
	{#if data.unavailable}
		<Alert tone="warn" title="The review plugin did not answer">
			It is compiled into this instance, but its routes are not responding. What is shown here
			may be short.
		</Alert>
	{/if}

	<div class="flex flex-col gap-6">
		{#if data.operator}
			<section class="flex flex-col gap-4" aria-label="Definitions">
				<div class="flex flex-wrap items-center justify-between gap-2">
					<SectionHeading level={2}>Definitions</SectionHeading>
					{#if workflows && workflows.limit !== null}
						<span class="text-xs text-muted" data-testid="workflow-count">
							{workflows.current} of {workflows.limit}
							{workflows.limit === 1 ? 'workflow' : 'workflows'}
						</span>
					{/if}
				</div>
				{#if ceilingRefusal}
					<RefusalNotice refusal={ceilingRefusal} />
				{/if}
				{#if data.definitionsForbidden}
					<Alert tone="warn">The engine refused the definition list to your roles.</Alert>
				{:else if data.definitions.length === 0}
					<EmptyState
						title="No definition yet"
						description="A definition is an ordered list of stages, each with a required role and an SLA. Content moves through it one stage at a time."
					>
						{#snippet iconSnippet()}<ClipboardCheck size={ICON.lg} />{/snippet}
						{#snippet action()}
							<Button variant="secondary" onclick={openCreate}>
								<Plus size={ICON.sm} />
								New definition
							</Button>
						{/snippet}
					</EmptyState>
				{:else}
					<Table label="Review definitions">
						<thead>
							<tr>
								<th scope="col">Name</th>
								<th scope="col">Schema</th>
								<th scope="col">Stages</th>
								<th scope="col">On approval</th>
								<th scope="col" class="text-right">Actions</th>
							</tr>
						</thead>
						<tbody>
							{#each data.definitions as row (row.definition.id)}
								<tr data-testid="definition-row">
									<td data-cell="nowrap">
										<span class="font-medium text-fg">{row.definition.name}</span>
										<span class="ml-2 font-mono text-xs text-faint">{row.definition.slug}</span>
									</td>
									<td data-cell="nowrap" class="font-mono text-xs">{row.definition.content_schema || 'default'}</td>
									<td>
										<ol class="flex flex-wrap items-center gap-1.5">
											{#each row.stages as stage, i (stage.id)}
												<li class="flex items-center gap-1 text-xs" data-testid="stage-chip">
													<span class="text-faint">{i + 1}.</span>
													<span class="text-fg">{stage.name}</span>
													{#if stage.required_role}
														<Badge tone="neutral" size="sm">{stage.required_role}</Badge>
													{/if}
													<span class="text-faint">{hours(stage.sla_duration_seconds)}</span>
													{#each stageNotes(stage) as note (note)}
														<Badge tone="violet" size="sm">{note}</Badge>
													{/each}
												</li>
											{/each}
										</ol>
									</td>
									<td data-cell="nowrap">
										<Badge tone={row.definition.publish_on_approve ? 'success' : 'neutral'}>
											{row.definition.publish_on_approve ? 'Publishes' : 'Stays as it was'}
										</Badge>
									</td>
									<td data-cell="nowrap" class="text-right">
										<Button
											variant="ghost"
											size="sm"
											onclick={() => askDelete(row.definition.id, row.definition.name)}
											title="Delete"
											aria-label="Delete {row.definition.name}"
										>
											<Trash2 size={ICON.sm} class="text-danger" />
										</Button>
									</td>
								</tr>
							{/each}
						</tbody>
					</Table>
				{/if}
			</section>
		{/if}

		<section class="flex flex-col gap-4" aria-label="Assignments">
			<SectionHeading level={2}>Assignments</SectionHeading>
			<ListToolbar label="Filter assignments">
				{#snippet filters()}
					<SegmentedControl label="Status" labelHidden value={data.status} options={statusOptions} />
				{/snippet}
			</ListToolbar>
			{#if data.assignmentsForbidden}
				<Alert tone="warn" title="You may not list reviews">
					The permission rules grant no read on <span class="font-mono">reviews</span> to your roles.
				</Alert>
			{:else if data.assignments.length === 0}
				<EmptyState
					title="Nothing under review"
					description={data.status
						? 'No assignment has this status. Widen the filter to see the rest.'
						: 'Start an entry through a definition from its editor and it appears here.'}
				>
					{#snippet iconSnippet()}<ClipboardCheck size={ICON.lg} />{/snippet}
				</EmptyState>
			{:else}
				<Table label="Review assignments">
					<thead>
						<tr>
							<th scope="col">Entry</th>
							<th scope="col">Definition</th>
							<th scope="col">Stage</th>
							<th scope="col">Status</th>
							<th scope="col">Assignee</th>
							<th scope="col">Due</th>
						</tr>
					</thead>
					<tbody>
						{#each data.assignments as a (a.id)}
							{@const href = entryHref(a.definition_id, a.entry_id)}
							{@const late = overdue(a)}
							<tr data-testid="assignment-row" data-status={a.status}>
								<td data-cell="nowrap" class="font-mono text-xs">
									{#if href}
										<a {href} class="text-brand underline-offset-2 hover:underline">{shortId(a.entry_id)}</a>
									{:else}
										{shortId(a.entry_id)}
									{/if}
								</td>
								<td data-cell="nowrap">{definitionName(a.definition_id)}</td>
								<td data-cell="nowrap">
									{stageName(a.definition_id, a.current_stage_id)}
									{#if a.required_approvals > 1}
										<Badge tone="neutral" size="sm">
											{a.approvals.length} of {a.required_approvals} approvals
										</Badge>
									{/if}
								</td>
								<td data-cell="nowrap">
									<Badge tone={STATUS_TONE[a.status]} dot>{STATUS_LABEL[a.status]}</Badge>
								</td>
								<td data-cell="nowrap" class="font-mono text-xs">
									{shortId(a.assignee_id)}
									{#if a.assignee_ids.length > 1}
										<span class="font-sans text-muted">and {a.assignee_ids.length - 1} more</span>
									{/if}
								</td>
								<td data-cell="nowrap" class={late ? 'text-danger' : ''} data-overdue={late}>
									{a.due_at ? formatDateTime(a.due_at) : NO_VALUE}
									{#if late}
										<Badge tone="danger" size="sm">Overdue</Badge>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</Table>
				<Pagination
					page={pageNumber(data.offset, data.limit)}
					perPage={data.limit}
					count={data.definitions.length}
					total={data.total}
					noun="definitions"
					href={(page) => pageHref(pageOffset(page, data.limit))}
				/>
			{/if}
		</section>
	</div>
</PageShell>

<Drawer bind:open title="New definition">
	<form
		method="POST"
		action="?/create"
		id="definition-form"
		use:enhance={submit.enhance}
		class="flex flex-col gap-4"
	>
		<FormErrors message={formError} {refused} />
		<input type="hidden" name="stages" value={stagesJSON} />
		<input type="hidden" name="publish_on_approve" value={publishOnApprove ? 'true' : 'false'} />
		<Input
			id="definition-name"
			name="name"
			label="Name"
			required
			bind:value={name}
			placeholder="Editorial review"
			error={errors.name}
		/>
		<Input
			id="definition-slug"
			name="slug"
			label="Slug"
			hint="What a permission rule names, as review:<slug>. Derived from the name when left empty, and never changes."
			bind:value={slug}
			class="font-mono"
			autocomplete="off"
		/>
		{#if schemaOptions.length > 0}
			<Select
				id="definition-schema"
				name="content_schema"
				label="Content schema"
				hint="The schema whose entries this definition reviews. Approval publishes the row there."
				options={schemaOptions}
				bind:value={contentSchema}
			/>
		{:else}
			<Input
				id="definition-schema"
				name="content_schema"
				label="Content schema"
				hint="The schema whose entries this definition reviews."
				value={contentSchema ?? ''}
				oninput={(e) => (contentSchema = (e.currentTarget as HTMLInputElement).value)}
				class="font-mono"
			/>
		{/if}
		<Toggle
			id="definition-publish"
			label="Publish on approval"
			hint="The last approval sets the entry to published. Off, the entry stays as it was and publish is a separate action."
			bind:checked={publishOnApprove}
		/>

		<Card>
			<div class="flex flex-col gap-3">
				<SectionHeading level={3}>Stages, in order</SectionHeading>
				<ol class="flex flex-col gap-3" aria-label="Stages">
					{#each stages as stage, i (stage.key)}
						<li class="flex flex-col gap-2 rounded-md border border-line bg-surface-2/40 p-3">
							<div class="flex items-center gap-2">
								<span class="text-xs text-faint">{i + 1}.</span>
								<div class="flex-1">
									<Input
										id="stage-name-{stage.key}"
										label="Stage name"
										required
										bind:value={stage.name}
										placeholder="Copy edit"
									/>
								</div>
								<Button
									type="button"
									variant="ghost"
									size="sm"
									aria-label="Move stage {i + 1} up"
									disabled={i === 0}
									onclick={() => move(i, -1)}
								>
									<ArrowUp size={ICON.sm} />
								</Button>
								<Button
									type="button"
									variant="ghost"
									size="sm"
									aria-label="Move stage {i + 1} down"
									disabled={i === stages.length - 1}
									onclick={() => move(i, 1)}
								>
									<ArrowDown size={ICON.sm} />
								</Button>
								<Button
									type="button"
									variant="ghost"
									size="sm"
									aria-label="Remove stage {i + 1}"
									disabled={stages.length === 1}
									onclick={() => (stages = stages.filter((s) => s.key !== stage.key))}
								>
									<X size={ICON.sm} />
								</Button>
							</div>
							<div class="grid gap-2 sm:grid-cols-2">
								<Input
									id="stage-role-{stage.key}"
									label="Required role"
									hint="Empty takes anyone the rules admit; admin and super_admin always may."
									bind:value={stage.required_role}
									placeholder="editor"
									mono
								/>
								<NumberInput
									id="stage-sla-{stage.key}"
									label="SLA, hours"
									hint="0 for none, up to 240."
									min={0}
									max={240}
									step={1}
									bind:value={stage.sla_hours}
								/>
							</div>
							<div class="flex flex-col gap-3 border-t border-line pt-3" data-testid="stage-paid-settings">
								{#if stagesLocked}
									<NotEnabled compact title="Quorum, escalation and conditions" />
								{/if}
								<NumberInput
									id="stage-quorum-{stage.key}"
									label="Approvals needed"
									hint="1 is a single approval. Above 1, that many assignees each approve."
									min={1}
									max={100}
									step={1}
									disabled={stagesLocked}
									bind:value={stage.quorum}
								/>
								<SegmentedControl
									label="On an SLA breach, hand it to"
									options={ESCALATE}
									disabled={stagesLocked || stage.sla_hours === 0}
									bind:value={stage.escalate_kind}
								/>
								{#if stage.escalate_kind !== 'none'}
									<Input
										id="stage-escalate-{stage.key}"
										label={stage.escalate_kind === 'user' ? 'User id' : 'Role'}
										hint={stage.escalate_kind === 'user'
											? 'The user becomes the assignee when the SLA passes.'
											: 'A holder of this role may act on the stage once the SLA passes.'}
										disabled={stagesLocked}
										bind:value={stage.escalate_to}
										mono
									/>
								{/if}
								<div class="grid gap-2 sm:grid-cols-2">
									<Input
										id="stage-condition-field-{stage.key}"
										label="Only when the field"
										hint="Empty runs the stage for every entry."
										disabled={stagesLocked}
										bind:value={stage.condition_field}
										placeholder="category"
										mono
									/>
									{#if stage.condition_field.trim()}
										<SegmentedControl
											label="Compares"
											options={OPS}
											disabled={stagesLocked}
											bind:value={stage.condition_op}
										/>
									{/if}
								</div>
								{#if stage.condition_field.trim() && stage.condition_op !== 'exists'}
									<Input
										id="stage-condition-value-{stage.key}"
										label={stage.condition_op === 'in' ? 'Values' : 'Value'}
										hint={stage.condition_op === 'in' ? 'One per comma, up to 100.' : 'A text, a number, or true or false.'}
										disabled={stagesLocked}
										bind:value={stage.condition_value}
									/>
								{/if}
							</div>
						</li>
					{/each}
				</ol>
				<div>
					<Button type="button" variant="secondary" size="sm" onclick={() => (stages = [...stages, blankStage()])}>
						<Plus size={ICON.sm} /> New stage
					</Button>
				</div>
			</div>
		</Card>
	</form>
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (open = false)}>Cancel</Button>
		<Button variant="primary" type="submit" form="definition-form" loading={submit.pending}>Create</Button>
	{/snippet}
</Drawer>

<form method="POST" action="?/delete" use:enhance bind:this={deleteForm} class="hidden">
	<input type="hidden" name="id" value={deleteId} />
</form>
