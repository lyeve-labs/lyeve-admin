<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidate } from '$app/navigation';
	import { navigating } from '$app/state';
	import type { SubmitFunction } from '@sveltejs/kit';
	import {
		Alert,
		Button,
		Card,
		CheckboxGroup,
		EmptyState,
		Indicator,
		MultiSelect,
		PageShell,
		Pagination,
		SectionHeading,
		SegmentedControl,
		Skeleton,
		Table,
	} from '@lyeve-labs/ui-kit';
	import { Download, Inbox, Trash2, TriangleAlert } from '@lucide/svelte';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import { confirmed, tracked } from '$lib/forms.svelte';
	import { formatDateTime, relativeTime } from '$lib/format';
	import { pageHref, pageNumber } from '$lib/api/list';
	import { ICON } from '$lib/icon';
	import {
		CONTACT_SCHEMA,
		FLOW_NOTE,
		FLOW_UNCHECKED,
		destinationProblem,
		flowProblem,
		formWarning,
		hasSubmissions,
		type FormRef,
		type FormState,
		type PublishedForm,
	} from '$lib/api/builder-forms';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const PATH = '/admin/forms';

	/** Every key an action answers with, each optional. */
	interface Answer {
		targetsSaved?: boolean;
		targetsError?: { field: string; message: string };
		setupDone?: { created: boolean };
		setupMissing?: boolean;
		setupError?: string;
		stateSet?: FormState;
		deleted?: boolean;
		entryError?: string;
	}
	const answer = $derived((form ?? {}) as Answer);

	const settings = $derived(data.settings?.ok ? data.settings.value : null);
	const schemas = $derived(data.schemas?.ok ? data.schemas.value : null);
	const flows = $derived(data.flows?.ok ? data.flows.value : null);

	function schemaLabel(name: string): string {
		return schemas?.find((s) => s.name === name)?.label ?? name;
	}

	function flowName(slug: string): string {
		return flows?.find((f) => f.slug === slug)?.name ?? slug;
	}

	/** The warning a form shows when its posts fail or start nothing. What did not load is not checked. */
	function warningOf(f: PublishedForm): string {
		const problem = destinationProblem(f.destination, settings, flows);
		if (!problem) return '';
		return formWarning(problem, f.destination?.schema ? schemaLabel(f.destination.schema) : flowName(f.destination?.flow ?? ''));
	}

	function formParams(ref: FormRef, state = 'new'): Record<string, string> {
		return { site: ref.site, path: ref.path, block: ref.block, state };
	}

	function formHref(ref: FormRef, state = 'new'): string {
		return `${PATH}?${new URLSearchParams(formParams(ref, state))}`;
	}

	function exportHref(ref: FormRef, state: string): string {
		const qs = new URLSearchParams({ site: ref.site, path: ref.path, block: ref.block });
		if (state !== 'all') qs.set('state', state);
		return `${PATH}/export?${qs}`;
	}

	// Where forms can send.
	const offered = $derived((schemas ?? []).filter((s) => !s.delivered));
	const anyDelivered = $derived((schemas ?? []).some((s) => s.delivered));
	// A content type allowed earlier and deleted or opened since is not offered, so the next save drops it.
	let pickedSchemas = $derived((settings?.form_schemas ?? []).filter((n) => offered.some((s) => s.name === n)));
	const goneSchemas = $derived(
		schemas ? (settings?.form_schemas ?? []).filter((n) => !offered.some((s) => s.name === n)) : [],
	);
	const schemaOptions = $derived(offered.map((s) => ({ value: s.name, label: s.label })));

	// A flow is offered when a form can start it. An allowed slug a form cannot
	// start stays in the list with the reason beside it, so it can be cleared.
	const flowOptions = $derived.by(() => {
		if (!flows) return [];
		const allowed = settings?.form_flows ?? [];
		// A flow whose trigger could not be read is listed only when it is already allowed, so a save keeps it.
		const rows: { value: string; label: string; description?: string }[] = flows
			.filter((f) => f.formTrigger === true || (f.formTrigger === null && allowed.includes(f.slug)))
			.map((f) => {
				const problem = flowProblem(f.slug, flows);
				return {
					value: f.slug,
					label: f.name,
					description: f.formTrigger === null ? FLOW_UNCHECKED : problem ? FLOW_NOTE[problem] : undefined,
				};
			});
		for (const slug of settings?.form_flows ?? []) {
			const problem = flowProblem(slug, flows);
			if (problem === 'missing' || problem === 'trigger') {
				rows.push({ value: slug, label: problem === 'missing' ? slug : flowName(slug), description: FLOW_NOTE[problem] });
			}
		}
		return rows;
	});
	let pickedFlows = $derived([...(settings?.form_flows ?? [])]);
	const flowNotes = $derived(flowOptions.filter((o) => o.description && pickedFlows.includes(o.value)));

	function errorOn(field: string): string | undefined {
		return answer.targetsError?.field === field ? answer.targetsError.message : undefined;
	}

	const keepValues: SubmitFunction = () => async ({ update }) => update({ reset: false });
	const saveTargets = tracked(keepValues);
	const setup = tracked(keepValues);

	const contactExists = $derived((schemas ?? []).some((s) => s.name === CONTACT_SCHEMA));
	const needsSetup = $derived(!!settings && !!schemas && settings.form_schemas.length === 0);
	const presetAvailable = $derived(data.presetOffered && !answer.setupMissing);

	// One form's submissions.
	const selected = $derived(data.selected);
	const subs = $derived(selected?.submissions?.ok ? selected.submissions.value : null);
	const loading = $derived(navigating.to?.url.pathname === PATH);

	const STATE_LABEL: Record<FormState, string> = { new: 'New', read: 'Read', spam: 'Spam' };
	const STATE_TONE = { new: 'brand', read: 'neutral', spam: 'warn' } as const;

	/** The triage moves a row offers, by its state. */
	const MOVES: Record<FormState, [FormState, string][]> = {
		new: [
			['read', 'Mark read'],
			['spam', 'Mark spam'],
		],
		read: [
			['new', 'Mark new'],
			['spam', 'Mark spam'],
		],
		spam: [['new', 'Not spam']],
	};

	/**
	 * A triage write changes one form's submissions and counts. It refreshes
	 * only the page data, so the flows are not read again on every click.
	 */
	const triage: SubmitFunction = () => async ({ result, update }) => {
		await update({ invalidateAll: false });
		if (result.type === 'success') await invalidate('forms:submissions');
	};

	function deleteOne(schema: string): SubmitFunction {
		const ask = confirmed(
			'Delete this submission?',
			`It is deleted from the ${schemaLabel(schema)} content type too. This cannot be undone.`,
			{ confirmLabel: 'Delete' },
		);
		return async (input) => {
			const after = await ask(input);
			return after ? triage(input) : after;
		};
	}

	function shown(v: unknown): string {
		if (v === null || v === undefined) return '';
		return typeof v === 'string' ? v : JSON.stringify(v);
	}
</script>

<PageShell title="Forms" description="Choose where builder forms can send, and read what visitors send." width="wide">
	{#if data.gate.state !== 'ok'}
		<GateNotice level={2} gate={data.gate} title="Forms" absent="Forms need a newer version of the builder plugin." />
	{:else}
		{#if answer.stateSet}
			<Alert tone="success" autoDismiss>Submission marked as {STATE_LABEL[answer.stateSet].toLowerCase()}.</Alert>
		{:else if answer.deleted}
			<Alert tone="success" autoDismiss>Submission deleted.</Alert>
		{:else if answer.entryError}
			<Alert tone="danger">{answer.entryError}</Alert>
		{/if}

		<section class="flex flex-col gap-4" aria-label="Forms on published pages">
			{#if data.forms.length === 0}
				<EmptyState level={2} title="No forms yet" description="Forms on pages you publish from the builder appear here.">
					{#snippet iconSnippet()}
						<Inbox size={ICON.lg} />
					{/snippet}
				</EmptyState>
			{:else}
				<Table label="Forms">
					<thead>
						<tr>
							<th scope="col">Form</th>
							<th scope="col">Page</th>
							<th scope="col">Sends to</th>
							<th scope="col">New</th>
							<th scope="col">Read</th>
							<th scope="col">Spam</th>
							<th scope="col"><span class="sr-only">Submissions</span></th>
						</tr>
					</thead>
					<tbody>
						{#each data.forms as f (`${f.site} ${f.path} ${f.block}`)}
							{@const warning = warningOf(f)}
							<tr>
								<td>
									<span class="font-medium text-fg" dir="auto">{f.label || f.block}</span>
									{#if warning}
										<div class="mt-1 flex items-start gap-1 text-xs text-warn" data-testid="form-warning">
											<TriangleAlert size={ICON.xs} aria-hidden="true" class="mt-0.5 shrink-0" />
											<span>{warning}</span>
										</div>
									{/if}
								</td>
								<td>
									<span class="font-mono text-xs">{f.path}</span>
									{#if f.site_name}
										<div class="text-xs text-faint" dir="auto">{f.site_name}</div>
									{:else}
										<div class="text-xs text-faint">Deleted site <span class="font-mono">{f.site}</span></div>
									{/if}
								</td>
								<td>
									{#if f.destination?.schema}
										{schemaLabel(f.destination.schema)}
										<div class="text-xs text-faint">Content type</div>
									{:else if f.destination?.flow}
										{flowName(f.destination.flow)}
										<div class="text-xs text-faint">Flow</div>
									{:else}
										<span class="text-muted">Not chosen</span>
									{/if}
								</td>
								<td data-cell="nowrap">{f.counts.new}</td>
								<td data-cell="nowrap">{f.counts.read}</td>
								<td data-cell="nowrap">{f.counts.spam}</td>
								<td data-cell="nowrap">
									{#if hasSubmissions(f)}
										<div class="flex justify-end">
											<Button variant="ghost" size="sm" href={formHref(f)}>View submissions</Button>
										</div>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</Table>
			{/if}
		</section>

		{#if selected}
			<section class="flex flex-col gap-4" aria-label="Submissions">
				<div class="flex flex-wrap items-center justify-between gap-3">
					<div>
						<SectionHeading level={2}>{selected.form?.label || selected.ref.block}</SectionHeading>
						<p class="font-mono text-xs text-faint">{selected.ref.path}</p>
					</div>
					<Button variant="ghost" size="sm" href={PATH}>Close</Button>
				</div>

				{#if !selected.form}
					<Alert tone="warn">This form is no longer on a published page.</Alert>
				{:else if !selected.submissions}
					<Alert tone="brand">Posts to this form start a flow. See what visitors sent in the flow's runs.</Alert>
				{:else if !selected.submissions.ok}
					<GateNotice gate={selected.submissions.gate} title="Submissions" absent="Submissions need a newer version of the builder plugin." />
				{:else}
					<div class="flex flex-wrap items-center justify-between gap-3">
						<SegmentedControl
							label="State"
							labelHidden
							value={selected.state}
							options={[
								{ value: 'new', label: 'New', href: formHref(selected.ref, 'new') },
								{ value: 'read', label: 'Read', href: formHref(selected.ref, 'read') },
								{ value: 'spam', label: 'Spam', href: formHref(selected.ref, 'spam') },
								{ value: 'all', label: 'All', href: formHref(selected.ref, 'all') },
							]}
						/>
						<Button variant="secondary" size="sm" href={exportHref(selected.ref, selected.state)} download data-sveltekit-reload>
							<Download size={ICON.sm} aria-hidden="true" /> Export CSV
						</Button>
					</div>

					{#if loading}
						<div class="flex flex-col gap-2" data-testid="submissions-loading">
							{#each [1, 2, 3, 4, 5] as row (row)}
								<Skeleton height="2.5rem" />
							{/each}
						</div>
					{:else if subs && subs.data.length === 0}
						{#if selected.state === 'all'}
							<EmptyState level={3} title="No submissions yet" description="What visitors send through this form appears here." />
						{:else}
							<EmptyState level={3} title="No submissions match this filter">
								{#snippet action()}
									<Button variant="secondary" href={formHref(selected.ref, 'all')}>Show all</Button>
								{/snippet}
							</EmptyState>
						{/if}
					{:else if subs}
						<Table label="Submissions">
							<thead>
								<tr>
									<th scope="col">Received</th>
									<th scope="col">What was sent</th>
									<th scope="col">State</th>
									<th scope="col"><span class="sr-only">Actions</span></th>
								</tr>
							</thead>
							<tbody>
								{#each subs.data as s (s.id)}
									<tr>
										<td data-cell="nowrap" class="text-xs text-faint" title={formatDateTime(s.created_at)}>
											{relativeTime(s.created_at)}
										</td>
										<td>
											<dl class="flex flex-col gap-1 text-sm">
												{#each Object.entries(s.fields) as [name, value] (name)}
													<div class="flex flex-wrap gap-x-2">
														<dt class="text-muted">{name}</dt>
														<dd class="break-words text-fg" dir="auto">{shown(value)}</dd>
													</div>
												{/each}
											</dl>
										</td>
										<td data-cell="nowrap">
											<span class="inline-flex items-center gap-2">
												<Indicator tone={STATE_TONE[s.state]} />
												{STATE_LABEL[s.state]}
											</span>
										</td>
										<td data-cell="nowrap">
											<div class="flex justify-end gap-1">
												{#each MOVES[s.state] as [to, label] (to)}
													<form method="POST" action="?/state" use:enhance={triage}>
														<input type="hidden" name="id" value={s.id} />
														<input type="hidden" name="state" value={to} />
														<Button variant="ghost" size="sm" type="submit">{label}</Button>
													</form>
												{/each}
												<form method="POST" action="?/delete" use:enhance={deleteOne(s.schema)}>
													<input type="hidden" name="id" value={s.id} />
													<Button variant="ghost" size="sm" type="submit" aria-label="Delete the submission from {relativeTime(s.created_at)}">
														<Trash2 size={ICON.sm} class="text-danger" aria-hidden="true" />
													</Button>
												</form>
											</div>
										</td>
									</tr>
								{/each}
							</tbody>
						</Table>
						<Pagination
							page={pageNumber(selected.offset, selected.limit)}
							perPage={selected.limit}
							count={subs.data.length}
							total={subs.total}
							hasNext={selected.offset + subs.data.length < subs.total}
							noun="submissions"
							href={pageHref(PATH, selected.limit, formParams(selected.ref, selected.state))}
						/>
					{/if}
				{/if}
			</section>
		{/if}

		<section class="flex flex-col gap-4" aria-label="Where forms can send">
			<SectionHeading level={2}>Where forms can send</SectionHeading>
			{#if !data.settings || !data.settings.ok}
				<GateNotice
					gate={data.settings ? data.settings.gate : { state: 'absent' }}
					title="Form settings"
					absent="Form settings need a newer version of the builder plugin."
				/>
			{:else}
				{#if needsSetup}
					<Card>
						<div class="flex flex-col items-start gap-3" data-testid="setup">
							<SectionHeading level={3}>Create a content type for form posts</SectionHeading>
							{#if answer.setupError}
								<Alert tone="danger">{answer.setupError}</Alert>
							{/if}
							{#if presetAvailable}
								<p class="text-sm text-muted">
									{#if contactExists}
										Let forms save posts into the Contact messages content type you already have.
									{:else}
										Add a Contact messages content type with name, email and message fields, and let forms save posts into it.
									{/if}
								</p>
								<form method="POST" action="?/setup" use:enhance={setup.enhance}>
									<Button variant="primary" type="submit" loading={setup.pending}>Set up</Button>
								</form>
							{:else}
								<p class="text-sm text-muted">Create a content type in the schema builder, then choose it below.</p>
								<Button variant="secondary" href="/admin/schema">Open the schema builder</Button>
							{/if}
						</div>
					</Card>
				{:else if answer.setupDone}
					<Alert tone="success" autoDismiss>
						{answer.setupDone.created ? 'Contact messages created. Forms can send to it now.' : 'Forms can send to Contact messages now.'}
					</Alert>
				{/if}

				<Card>
					<form method="POST" action="?/targets" use:enhance={saveTargets.enhance} class="flex flex-col items-start gap-6">
						{#if answer.targetsSaved}
							<Alert tone="success" autoDismiss>Settings saved.</Alert>
						{/if}

						<!-- Only a list that loaded is saved, so a list that failed to load clears nothing. -->
						{#if data.schemas?.ok}
							<input type="hidden" name="schemas_offered" value="1" />
						{/if}
						{#if data.flows?.ok}
							<input type="hidden" name="flows_offered" value="1" />
						{/if}
						{#if !data.schemas || !data.schemas.ok}
							<GateNotice gate={data.schemas ? data.schemas.gate : { state: 'absent' }} title="Content types" absent="Content types are not included in this build." />
						{:else if offered.length === 0}
							<p class="text-sm text-muted">No content types forms can send to yet.</p>
						{:else}
							{#if offered.length <= 12}
								<CheckboxGroup
									label="Content types"
									name="form_schemas"
									bind:value={pickedSchemas}
									options={schemaOptions}
									orientation="horizontal"
									hint="Forms can save posts into the content types you choose."
									error={errorOn('form_schemas')}
								/>
							{:else}
								<MultiSelect
									id="form-schemas"
									label="Content types"
									bind:value={pickedSchemas}
									options={schemaOptions}
									searchable
									hint="Forms can save posts into the content types you choose."
									error={errorOn('form_schemas')}
								/>
								{#each pickedSchemas as name (name)}
									<input type="hidden" name="form_schemas" value={name} />
								{/each}
							{/if}
						{/if}
						{#if anyDelivered}
							<p class="text-sm text-muted">
								Content types anyone can read through the delivery API are not listed, because anyone could read what visitors send.
							</p>
						{/if}
						{#if goneSchemas.length > 0}
							<Alert tone="warn">
								Forms cannot send to {goneSchemas.join(', ')} any more. Save to clear {goneSchemas.length === 1 ? 'it' : 'them'}.
							</Alert>
						{/if}

						{#if data.flows === null}
							<p class="text-sm text-muted">The flow plugin is not running on this instance, so forms cannot start flows.</p>
						{:else if !data.flows.ok}
							<GateNotice gate={data.flows.gate} title="Flows" absent="Flows are not included in this build." />
						{:else if flowOptions.length === 0}
							<p class="text-sm text-muted">
								No flow starts from a builder form yet. <a class="text-brand underline" href="/admin/flows">Create a flow</a> whose
								trigger is the builder form event.
							</p>
						{:else}
							{#if flowOptions.length <= 12}
								<CheckboxGroup
									label="Flows"
									name="form_flows"
									bind:value={pickedFlows}
									options={flowOptions}
									hint="Forms can start the flows you choose. Only flows that start from a builder form are listed."
									error={errorOn('form_flows')}
								/>
							{:else}
								<MultiSelect
									id="form-flows"
									label="Flows"
									bind:value={pickedFlows}
									options={flowOptions.map((o) => ({ value: o.value, label: o.label }))}
									searchable
									hint="Forms can start the flows you choose. Only flows that start from a builder form are listed."
									error={errorOn('form_flows')}
								/>
								{#each pickedFlows as slug (slug)}
									<input type="hidden" name="form_flows" value={slug} />
								{/each}
								{#if flowNotes.length > 0}
									<ul class="flex flex-col gap-1 text-sm text-warn">
										{#each flowNotes as note (note.value)}
											<li><span class="font-mono">{note.value}</span>: {note.description}</li>
										{/each}
									</ul>
								{/if}
							{/if}
						{/if}

						{#if answer.targetsError && !['form_schemas', 'form_flows'].includes(answer.targetsError.field)}
							<Alert tone="danger">{answer.targetsError.message}</Alert>
						{/if}

						<Button variant="primary" type="submit" loading={saveTargets.pending}>Save</Button>
					</form>
				</Card>
			{/if}
		</section>
	{/if}
</PageShell>
