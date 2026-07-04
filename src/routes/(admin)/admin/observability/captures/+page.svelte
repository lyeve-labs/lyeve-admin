<script lang="ts">
	import PageTitle from '$lib/components/PageTitle.svelte';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import RefusalNotice from '$lib/components/RefusalNotice.svelte';
	import { formRefusal } from '$lib/api/refusal';
	import {
		Alert,
		Badge,
		Button,
		Checkbox,
		Drawer,
		EmptyState,
		Input,
		PageShell,
		Pagination,
		SectionHeading,
		Select,
		Table,
		Toggle,
		confirm as confirmDialog,
		toast,
	} from '@lyeve-labs/ui-kit';
	import { enhance } from '$app/forms';
	import { tracked } from '$lib/forms.svelte';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { FileStack, History, Pencil, Play, Plus, Trash2 } from '@lucide/svelte';
	import {
		MAX_SET_CAPTURES,
		RULE_METHODS,
		capturePath,
		diffChanged,
		methodLabel,
		retentionLabel,
		retentionOptions,
		sampleLabel,
		type CaptureRule,
		type ReplaySet,
		type RuleMethod,
		type SetReplay,
	} from '$lib/api/request-capture';
	import { formatDateTime } from '$lib/format';
	import { pageHref, pageNumber } from '$lib/api/list';
	import { ICON } from '$lib/icon';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const refusal = $derived(formRefusal(form));
	const formError = $derived((form as { error?: string } | null)?.error ?? '');
	const needsWrites = $derived((form as { needsWrites?: string } | null)?.needsWrites ?? '');
	const replay = $derived((form as { replay?: SetReplay } | null)?.replay ?? null);
	const replayedSet = $derived(replay ? data.sets.find((s) => s.id === replay.set_id) : undefined);
	const capturesById = $derived(new Map(data.captures.map((c) => [c.id, c])));
	const enabledRules = $derived(data.rules.filter((r) => r.enabled).length);

	let selected = $state<string[]>([]);
	function toggleCapture(id: string, on: boolean) {
		selected = on ? [...new Set([...selected, id])] : selected.filter((x) => x !== id);
	}

	let ruleOpen = $state(false);
	let editing = $state<CaptureRule | null>(null);
	let routePattern = $state('/api/v1/**');
	let ruleMethod = $state<RuleMethod>('*');
	let samplePercent = $state('100');
	let retention = $state('86400');
	let ruleEnabled = $state(true);

	function openCreate() {
		editing = null;
		routePattern = '/api/v1/**';
		ruleMethod = '*';
		samplePercent = '100';
		retention = '86400';
		ruleEnabled = true;
		ruleOpen = true;
	}

	function openEdit(r: CaptureRule) {
		editing = r;
		routePattern = r.route_pattern;
		ruleMethod = r.method;
		samplePercent = String(Math.round(r.sample_rate * 1000) / 10);
		retention = String(r.retention_seconds);
		ruleEnabled = r.enabled;
		ruleOpen = true;
	}

	const saveRule = tracked(() => {
		const verb = editing ? 'Saved' : 'Created';
		const subject = routePattern;
		return async ({ result, update }) => {
			if (result.type !== 'failure') ruleOpen = false;
			await update();
			if (result.type === 'success') toast.success(`${verb} ${subject}`);
		};
	});

	let setOpen = $state(false);
	let setName = $state('');

	function openSet() {
		setName = '';
		setOpen = true;
	}

	const saveSet = tracked(() => {
		const subject = setName;
		return async ({ result, update }) => {
			if (result.type !== 'failure') {
				setOpen = false;
				selected = [];
			}
			await update();
			if (result.type === 'success') toast.success(`Created ${subject}`);
		};
	});

	function remove(what: string, detail: string): SubmitFunction {
		return async ({ cancel }) => {
			const confirmed = await confirmDialog(`Delete ${what}?`, detail, { confirmLabel: 'Delete' });
			if (!confirmed) {
				cancel();
				return;
			}
			return async ({ result, update }) => {
				await update();
				if (result.type === 'success') toast.success(`Deleted ${what}`);
			};
		};
	}

	/**
	 * A replay sends each request again with the caller's own credentials in
	 * place of the redacted ones, so the confirm says that before it runs.
	 */
	function runSet(s: ReplaySet, writes: boolean): SubmitFunction {
		return async ({ cancel }) => {
			const confirmed = await confirmDialog(
				writes ? `Replay ${s.name}, writes included?` : `Replay ${s.name}?`,
				writes
					? 'Every request in the set runs again with your credentials, and each write is repeated.'
					: 'Every request in the set runs again against this instance with your credentials in place of the ones that were redacted.',
				{ confirmLabel: 'Replay' },
			);
			if (!confirmed) {
				cancel();
				return;
			}
			return async ({ update }) => {
				await update({ reset: false });
			};
		};
	}
</script>

<PageTitle title="Request capture" />

<PageShell
	title="Request capture"
	description="Requests this tenant sent, kept with their responses so they can be replayed and compared."
	width="wide"
	back={{ href: '/admin/observability', label: 'Observability' }}
>
	{#snippet actions()}
		{#if data.gate.state === 'ok'}
			<Button variant="primary" size="sm" onclick={openCreate}>
				<Plus size={ICON.sm} /> New rule
			</Button>
		{/if}
	{/snippet}

	{#if data.gate.state !== 'ok'}
		<GateNotice
			gate={data.gate}
			title="Request capture"
			absent="The request capture plugin is not part of this build, so no request is kept."
		/>
	{:else}
		{#if refusal}
			<RefusalNotice {refusal} />
		{:else if needsWrites}
			{@const s = data.sets.find((x) => x.id === needsWrites)}
			<Alert tone="warn" title="This set holds a write">
				<p>Replaying it repeats each write against this instance. Nothing in the set has run yet.</p>
				{#if s}
					<form method="POST" action="?/replaySet" class="mt-3" use:enhance={runSet(s, true)}>
						<input type="hidden" name="id" value={s.id} />
						<input type="hidden" name="confirm_mutating" value="true" />
						<Button variant="secondary" size="sm" type="submit">Replay including writes</Button>
					</form>
				{/if}
			</Alert>
		{:else if formError}
			<Alert tone="danger">{formError}</Alert>
		{/if}

		{#if data.licensed === false}
			<Alert tone="brand" title="Capture rules and replay sets are not included">
				This install keeps every request for a day and replays them one at a time. Creating a rule, enabling one,
				or saving a replay set needs a license that includes them. Rules and sets already saved keep working, and
				switching a rule off or deleting one is always allowed.
			</Alert>
		{/if}

		<section class="flex flex-col gap-4" aria-label="Capture rules">
			<SectionHeading level={2}>Capture rules</SectionHeading>
			<p class="text-sm text-muted">
				{#if enabledRules > 0}
					This tenant keeps only the requests an enabled rule matches, sampled at its rate and kept for its
					retention. The first rule that matches a request decides.
				{:else}
					With no enabled rule, every request is kept for a day. The first enabled rule narrows that to what
					the rules match.
				{/if}
			</p>
			{#if !data.rulesRead}
				<Alert tone="danger">The capture rules could not be read. This is not a report that there are none.</Alert>
			{:else if data.rules.length === 0}
				<EmptyState title="No capture rule" description="Every request this tenant sends is kept for a day.">
					{#snippet iconSnippet()}
						<History size={ICON.lg} />
					{/snippet}
					{#snippet action()}
						<Button variant="secondary" onclick={openCreate}>
							<Plus size={ICON.sm} /> New rule
						</Button>
					{/snippet}
				</EmptyState>
			{:else}
				<Table label="Capture rules">
					<thead>
						<tr>
							<th scope="col">Route</th>
							<th scope="col">Method</th>
							<th scope="col">Sample</th>
							<th scope="col">Kept for</th>
							<th scope="col">State</th>
							<th scope="col"><span class="sr-only">Actions</span></th>
						</tr>
					</thead>
					<tbody>
						{#each data.rules as r (r.id)}
							<tr>
								<td class="max-w-md truncate font-mono text-xs" title={r.route_pattern}>{r.route_pattern}</td>
								<td data-cell="nowrap" class="text-xs">{methodLabel(r.method)}</td>
								<td data-cell="nowrap" class="font-mono text-xs">{sampleLabel(r.sample_rate)}</td>
								<td data-cell="nowrap" class="text-xs">{retentionLabel(r.retention_seconds)}</td>
								<td data-cell="nowrap">
									<Badge tone={r.enabled ? 'success' : 'neutral'} dot>{r.enabled ? 'Capturing' : 'Off'}</Badge>
								</td>
								<td data-cell="nowrap">
									<div class="flex items-center justify-end gap-1">
										<Button variant="ghost" size="sm" aria-label="Edit {r.route_pattern}" onclick={() => openEdit(r)}>
											<Pencil size={ICON.sm} />
										</Button>
										<form
											method="POST"
											action="?/deleteRule"
											use:enhance={remove(
												`the rule for ${r.route_pattern}`,
												'The captures it kept stay until their retention ends.',
											)}
										>
											<input type="hidden" name="id" value={r.id} />
											<Button variant="ghost" size="sm" type="submit" aria-label="Delete {r.route_pattern}">
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

		<section class="flex flex-col gap-4" aria-label="Replay sets">
			<SectionHeading level={2}>Replay sets</SectionHeading>
			{#if !data.setsRead}
				<Alert tone="danger">The replay sets could not be read. This is not a report that there are none.</Alert>
			{:else if data.sets.length === 0}
				<p class="text-sm text-muted">
					No replay set yet. Select captures below and save them as a set to replay them together and compare
					each response with the original.
				</p>
			{:else}
				<Table label="Replay sets">
					<thead>
						<tr>
							<th scope="col">Set</th>
							<th scope="col">Captures</th>
							<th scope="col">Created</th>
							<th scope="col"><span class="sr-only">Actions</span></th>
						</tr>
					</thead>
					<tbody>
						{#each data.sets as s (s.id)}
							<tr>
								<td class="font-medium text-fg">{s.name}</td>
								<td data-cell="nowrap" class="font-mono text-xs">{s.capture_ids.length}</td>
								<td data-cell="nowrap" class="text-xs text-faint">{formatDateTime(s.created_at)}</td>
								<td data-cell="nowrap">
									<div class="flex items-center justify-end gap-1">
										<form method="POST" action="?/replaySet" use:enhance={runSet(s, false)}>
											<input type="hidden" name="id" value={s.id} />
											<Button variant="ghost" size="sm" type="submit" aria-label="Replay {s.name}" title="Replay">
												<Play size={ICON.sm} />
											</Button>
										</form>
										<form
											method="POST"
											action="?/deleteSet"
											use:enhance={remove(s.name, 'Its captures stay. Only the list is deleted.')}
										>
											<input type="hidden" name="id" value={s.id} />
											<Button variant="ghost" size="sm" type="submit" aria-label="Delete {s.name}">
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

			{#if replay}
				<div class="flex flex-col gap-3" data-testid="replay-results">
					<SectionHeading level={3}>Replayed {replayedSet?.name ?? 'the set'}</SectionHeading>
					<p class="text-sm text-muted">
						{replay.results.filter((r) => r.diff && !diffChanged(r.diff)).length} of {replay.results.length} answered
						as they did when captured.
					</p>
					{#each replay.results as r (r.capture_id)}
						{@const original = capturesById.get(r.capture_id)}
						<div class="rounded border border-line bg-surface-2 p-3">
							<div class="flex flex-wrap items-center gap-2">
								{#if r.method && r.path}
									<span class="font-mono text-xs text-fg">{r.method} {r.path}</span>
								{:else if original}
									<span class="font-mono text-xs text-fg">{original.method} {capturePath(original.url)}</span>
								{:else}
									<span class="font-mono text-xs text-faint">{r.capture_id}</span>
								{/if}
								{#if r.error}
									<Badge tone="danger">Not replayed</Badge>
								{:else if r.diff}
									<Badge tone={diffChanged(r.diff) ? 'warn' : 'success'} dot>
										{diffChanged(r.diff) ? 'Changed' : 'Same'}
									</Badge>
								{/if}
							</div>
							{#if r.error}
								<p class="mt-1 text-xs text-muted">{r.error}</p>
							{:else if r.diff}
								<p class="mt-1 font-mono text-xs text-muted">
									Status {r.diff.status_code1} then {r.diff.status_code2}, {Math.round(r.diff.duration1_ms)} ms then
									{Math.round(r.diff.duration2_ms)} ms
								</p>
								{#if r.diff.headers_diff}
									<pre class="mt-2 overflow-x-auto font-mono text-xs text-muted">{r.diff.headers_diff}</pre>
								{/if}
								{#if r.diff.body_diff}
									<pre class="mt-2 overflow-x-auto font-mono text-xs text-muted">{r.diff.body_diff}</pre>
								{/if}
							{/if}
						</div>
					{/each}
				</div>
			{/if}
		</section>

		<section class="flex flex-col gap-4" aria-label="Captures">
			<div class="flex flex-wrap items-center justify-between gap-2">
				<SectionHeading level={2}>Captures</SectionHeading>
				{#if data.captures.length > 0}
					<Button
						variant="secondary"
						size="sm"
						disabled={selected.length === 0 || selected.length > MAX_SET_CAPTURES}
						onclick={openSet}
					>
						<FileStack size={ICON.sm} /> New replay set{selected.length > 0 ? ` from ${selected.length}` : ''}
					</Button>
				{/if}
			</div>
			{#if selected.length > MAX_SET_CAPTURES}
				<Alert tone="warn">A set holds at most {MAX_SET_CAPTURES} captures, because a replay runs them in one request.</Alert>
			{/if}
			{#if data.captures.length === 0}
				<EmptyState
					title="No request is kept"
					description="Requests appear here as this tenant sends them, unless a rule leaves them out."
				>
					{#snippet iconSnippet()}
						<History size={ICON.lg} />
					{/snippet}
				</EmptyState>
			{:else}
				<Table label="Captures">
					<thead>
						<tr>
							<th scope="col"><span class="sr-only">Select</span></th>
							<th scope="col">Request</th>
							<th scope="col">Status</th>
							<th scope="col">Took</th>
							<th scope="col">Captured</th>
						</tr>
					</thead>
					<tbody>
						{#each data.captures as c (c.id)}
							<tr>
								<td data-cell="nowrap">
									<Checkbox
										id="pick-{c.id}"
										label="Select {c.method} {capturePath(c.url)}"
										labelHidden
										checked={selected.includes(c.id)}
										onchange={(on) => toggleCapture(c.id, on)}
									/>
								</td>
								<td class="max-w-md truncate font-mono text-xs" title={c.url}>
									{c.method} {capturePath(c.url)}
								</td>
								<td data-cell="nowrap">
									<Badge tone={c.status_code >= 500 ? 'danger' : c.status_code >= 400 ? 'warn' : 'neutral'}>
										{c.status_code}
									</Badge>
								</td>
								<td data-cell="nowrap" class="font-mono text-xs">{Math.round(c.duration_ms)} ms</td>
								<td data-cell="nowrap" class="text-xs text-faint">{formatDateTime(c.captured_at)}</td>
							</tr>
						{/each}
					</tbody>
				</Table>
				<Pagination
					page={pageNumber(data.offset, data.limit)}
					perPage={data.limit}
					count={data.captures.length}
					total={data.total ?? undefined}
					hasNext={data.hasMore}
					noun="captures"
					href={pageHref('/admin/observability/captures', data.limit)}
				/>
			{/if}
		</section>
	{/if}
</PageShell>

<Drawer bind:open={ruleOpen} title={editing ? 'Edit rule' : 'New rule'}>
	{#if refusal}
		<div class="mb-4"><RefusalNotice {refusal} /></div>
	{:else if formError}
		<div class="mb-4"><Alert tone="danger">{formError}</Alert></div>
	{/if}
	<form id="capture-rule-form" method="POST" action={editing ? '?/updateRule' : '?/createRule'} use:enhance={saveRule.enhance}>
		{#if editing}
			<input type="hidden" name="id" value={editing.id} />
		{/if}
		<div class="flex flex-col gap-4">
			<Input
				id="capture-pattern"
				name="route_pattern"
				label="Route"
				hint="An absolute path. A segment may be * or a {'{name}'} for any one segment, and ** may end it."
				bind:value={routePattern}
				required
			/>
			<Select
				id="capture-method"
				name="method"
				label="Method"
				bind:value={ruleMethod}
				options={RULE_METHODS.map((m) => ({ value: m, label: methodLabel(m) }))}
			/>
			<Input
				id="capture-sample"
				name="sample_percent"
				label="Sample, as a percentage"
				hint="The share of matching requests kept. 100 keeps every one."
				bind:value={samplePercent}
			/>
			<Select
				id="capture-retention"
				name="retention_seconds"
				label="Kept for"
				hint="From an hour to 30 days. A replay of a capture is kept as long."
				bind:value={retention}
				options={retentionOptions(editing?.retention_seconds)}
			/>
			<input type="hidden" name="enabled" value={ruleEnabled ? 'true' : 'false'} />
			<Toggle id="capture-enabled" label="Apply this rule" bind:checked={ruleEnabled} />
		</div>
	</form>
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (ruleOpen = false)}>Cancel</Button>
		<Button variant="primary" type="submit" form="capture-rule-form" loading={saveRule.pending}>
			{editing ? 'Save' : 'Create'}
		</Button>
	{/snippet}
</Drawer>

<Drawer bind:open={setOpen} title="New replay set">
	{#if refusal}
		<div class="mb-4"><RefusalNotice {refusal} /></div>
	{:else if formError}
		<div class="mb-4"><Alert tone="danger">{formError}</Alert></div>
	{/if}
	<form id="replay-set-form" method="POST" action="?/createSet" use:enhance={saveSet.enhance}>
		{#each selected as id (id)}
			<input type="hidden" name="capture_id" value={id} />
		{/each}
		<div class="flex flex-col gap-4">
			<Input id="set-name" name="name" label="Name" bind:value={setName} required />
			<p class="text-sm text-muted">
				{selected.length}
				{selected.length === 1 ? 'capture' : 'captures'}, replayed in the order they were selected. A capture that
				expires before a replay is reported as not replayed and the rest still run.
			</p>
		</div>
	</form>
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (setOpen = false)}>Cancel</Button>
		<Button variant="primary" type="submit" form="replay-set-form" loading={saveSet.pending}>Create</Button>
	{/snippet}
</Drawer>
