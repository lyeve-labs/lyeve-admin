<script lang="ts">
	import PageTitle from '$lib/components/PageTitle.svelte';
	import {
		Alert,
		Badge,
		Button,
		Drawer,
		EmptyState,
		FileInput,
		Input,
		PageShell,
		Pagination,
		SearchInput,
		SegmentedControl,
		Select,
		Table,
		Textarea,
		Tooltip,
		confirm as confirmDialog,
	} from '@lyeve-labs/ui-kit';
	import { Database, Plus, Trash2, Upload, Variable, Workflow } from '@lucide/svelte';
	import { enhance } from '$app/forms';
	import type { ActionData, PageData } from './$types';
	import ListToolbar from '$lib/components/ListToolbar.svelte';
	import NotEnabled from '$lib/components/NotEnabled.svelte';
	import { submitter } from '$lib/forms.svelte';
	import { slugify, statusTone, triggerLabel } from '$lib/flow/triggers';
	import { blockedText } from '$lib/flow/blocked';
	import { flowGrants } from '$lib/flow/permissions';
	import type { RefusalNotice } from '$lib/flow/types';
	import { useInstance } from '$lib/instance.svelte';
	import type { Flow } from '$lib/api/flows';
	import { listQuery } from '$lib/back';
	import { pageHref, pageNumber } from '$lib/api/list';
	import { relativeTime, formatDateTime } from '$lib/format';
	import { ICON } from '$lib/icon';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const submit1 = submitter(() => (showCreate = false));
	const submit2 = submitter(() => (showImport = false));

	// The shell shows why the page is unavailable while the flow plugin does
	// not run. A plugin that runs and refuses its routes is said here.
	const enabled = $derived(!data.locked);

	// A control the caller's roles cannot use is not drawn: the plugin says
	// beside the list whether the caller may create, and on each flow what
	// it may do to it. The engine still decides, and a refusal it answers
	// renders below like any other.
	const canCreate = $derived(data.canCreate !== false);
	const canDelete = (flow: Flow) => flowGrants(flow.actions).delete;

	// The dialog asks for a name and derives the slug, and nothing else. A
	// template is a question for a reader who has a canvas to put it on, so
	// the editor asks it, from its empty state, beside the palette and the
	// import.
	let showCreate = $state(false);
	let createName = $state('');
	let createSlug = $state('');
	let slugTouched = $state(false);

	function openCreate() {
		slugTouched = false;
		createName = '';
		createSlug = '';
		showCreate = true;
	}

	function onNameInput(e: Event) {
		createName = (e.currentTarget as HTMLInputElement).value;
		if (!slugTouched) createSlug = slugify(createName);
	}

	let showImport = $state(false);
	let importMode = $state<string | null>('create');

	// Delete goes through the kit's confirm dialog, then a hidden form, so the
	// row's button never posts on its own and the action stays a form action.
	let deleteId = $state('');
	let deleteForm = $state<HTMLFormElement>();

	async function askDelete(id: string, name: string) {
		const ok = await confirmDialog(
			`Delete ${name}?`,
			'Its versions and run history go with it.',
			{ confirmLabel: 'Delete' }
		);
		if (!ok) return;
		deleteId = id;
		await Promise.resolve();
		deleteForm?.requestSubmit();
	}

	const errorList = $derived(
		form && 'errors' in form && Array.isArray(form.errors) ? form.errors : []
	);
	const imported = $derived(form && 'imported' in form ? form.imported : null);
	const refusal = $derived(form && 'refusal' in form && form.refusal ? (form.refusal as RefusalNotice) : null);
	const instance = useInstance();
	const enableLink = $derived(instance.upgradeLink());

	const MODES = [
		{ value: 'create', label: 'Create a new flow' },
		{ value: 'replace', label: 'Replace the draft of an existing flow' },
	];

	// The filter lives in the URL, so a filtered view is a link someone can
	// keep and the list renders filtered without hydration. Each status is a
	// link carrying the search, as the content index's chips are, so one click
	// lands on it. A radio that submits from its change handler runs before the
	// hidden status field re-renders and posts the status it is leaving. The
	// search waits for Enter or the button so a half-typed word does not reload.
	const STATUSES = [
		{ value: '', label: 'All' },
		{ value: 'draft', label: 'Draft' },
		{ value: 'active', label: 'Active' },
		{ value: 'disabled', label: 'Disabled' },
		{ value: 'blocked', label: 'Blocked' },
	];
	const statusOptions = $derived(
		STATUSES.map((o) => ({ ...o, href: `/admin/flows${listQuery({ status: o.value, q: data.q })}` })),
	);
	// Re-derived when a navigation changes the URL, so Clear and the back
	// button put the box where the list is.
	let q = $derived(data.q);
	const filtered = $derived(data.status !== '' || data.q !== '');
	// A row link carries the filter it was found under, so the editor's back
	// link returns to the same slice of the list.
	const rowQuery = $derived(listQuery({ status: data.status, q: data.q }));
</script>

<PageTitle title="Flows" />

{#if enabled}
	<PageShell
		title="Flows"
		description="Custom API endpoints and automations, built on a canvas."
		width="wide"
	>
		{#snippet actions()}
			<Badge tone="violet" size="sm">Beta</Badge>
			<Button variant="ghost" size="sm" href="/admin/flows/datasources">
				<Database size={ICON.sm} />
				Datasources
			</Button>
			<Button variant="ghost" size="sm" href="/admin/flows/variables">
				<Variable size={ICON.sm} />
				Variables
			</Button>
			{#if canCreate}
				<Button variant="secondary" size="sm" onclick={() => (showImport = true)}>
					<Upload size={ICON.sm} />
					Import
				</Button>
				<Button variant="primary" size="sm" onclick={() => openCreate()}>
					<Plus size={ICON.sm} />
					New flow
				</Button>
			{/if}
		{/snippet}

		{#if data.loadError}
			<Alert tone="danger" title="Flows could not be loaded">
				{#snippet children()}{data.loadError} Reload once the engine answers again.{/snippet}
			</Alert>
		{/if}

		{#if refusal}
			<Alert tone="warn" title={refusal.limit !== null ? 'Flow limit reached' : 'Not enabled on this instance'}>
				{#snippet children()}
					{form && 'error' in form ? form.error : ''}
					{#if enableLink}
						<a class="ml-1 underline" href={enableLink.href}>{enableLink.label ?? (refusal.limit !== null ? 'How to raise the limit' : 'How to enable it')}</a>
					{/if}
					{#if errorList.length > 0}
						<ul class="mt-1 list-disc pl-5">
							{#each errorList as err (`${err.node_id ?? ''}${err.path}${err.message}`)}
								<li class="font-mono text-xs">{err.node_id ? `${err.node_id} ` : ''}{err.path}: {err.message}</li>
							{/each}
						</ul>
					{/if}
				{/snippet}
			</Alert>
		{:else if form && 'forbidden' in form && form.forbidden}
			<Alert tone="danger" title="Your role cannot do that">
				{#snippet children()}{form.error}{/snippet}
			</Alert>
		{:else if form && 'error' in form && form.error}
			<Alert tone="danger">
				{#snippet children()}
					{form.error}
					{#if errorList.length > 0}
						<ul class="mt-1 list-disc pl-5">
							{#each errorList as err (`${err.node_id ?? ''}${err.path}${err.message}`)}
								<li class="font-mono text-xs">{err.node_id ? `${err.node_id} ` : ''}{err.path}: {err.message}</li>
							{/each}
						</ul>
					{/if}
				{/snippet}
			</Alert>
		{/if}

		{#if imported}
			<Alert tone="warn" title="Imported with unresolved datasources">
				{#snippet children()}
					<span>{imported.name} was imported. These datasources do not exist here yet: {imported.unresolved.join(', ')}.</span>
					<a class="ml-1 underline" href="/admin/flows/{imported.id}">Open the flow</a>
				{/snippet}
			</Alert>
		{/if}

		<!-- The field's label is for the screen reader only, so nothing sits
		     above the row to push its middle down. -->
		<form method="GET" data-testid="flow-filters">
			{#if data.status}<input type="hidden" name="status" value={data.status} />{/if}
			<ListToolbar label="Filter flows">
				{#snippet search()}
					<div class="flex items-center gap-2">
						<label for="flow-search" class="sr-only">Search flows</label>
						<SearchInput id="flow-search" name="q" bind:value={q} placeholder="Name or slug" class="min-w-0 flex-1" />
						<Button type="submit" variant="secondary">Search</Button>
						{#if filtered}
							<Button variant="ghost" href="/admin/flows">Clear</Button>
						{/if}
					</div>
				{/snippet}
				{#snippet filters()}
					<nav aria-label="Status">
						<SegmentedControl label="Status" labelHidden value={data.status} options={statusOptions} />
					</nav>
				{/snippet}
			</ListToolbar>
		</form>

		{#if data.loadError}
			<!-- Nothing: the empty state would say there are none. -->
		{:else if data.flows.length === 0 && filtered}
			<EmptyState title="No flows match" description="Widen the status or clear the search to see more." />
		{:else if data.flows.length === 0}
			<EmptyState
				title="No flows yet"
				description="Name one to open the editor, where you can start from the palette, a template or an import."
			>
				{#snippet iconSnippet()}<Workflow size={ICON.lg} />{/snippet}
				{#snippet action()}
					{#if canCreate}
						<Button variant="secondary" onclick={() => openCreate()}>
							<Plus size={ICON.sm} />
							New flow
						</Button>
					{/if}
				{/snippet}
			</EmptyState>
		{:else}
			<Table hoverable label="Flows">
				<thead>
					<tr>
						<th scope="col">Name</th>
						<th scope="col">Slug</th>
						<th scope="col">Status</th>
						<th scope="col">Trigger</th>
						<th scope="col">Version</th>
						<th scope="col">Last run</th>
						<th scope="col">Actions</th>
					</tr>
				</thead>
				<tbody>
					{#each data.flows as flow (flow.id)}
						<tr>
							<td data-cell="nowrap" class="font-medium">
								<a class="text-fg hover:text-brand" href="/admin/flows/{flow.id}{rowQuery}">{flow.name}</a>
							</td>
							<td data-cell="nowrap" class="font-mono text-xs text-muted">{flow.slug}</td>
							<td>
								{#if flow.status === 'blocked'}
									<!-- The list has no validation to name the plugin. The editor does. -->
									<Tooltip text={blockedText()} position="bottom">
										<Badge tone={statusTone(flow.status)} dot>{flow.status}</Badge>
									</Tooltip>
								{:else}
									<Badge tone={statusTone(flow.status)} dot>{flow.status}</Badge>
								{/if}
							</td>
							<td data-cell="nowrap" class="text-muted">{triggerLabel(flow.trigger_type)}</td>
							<td data-cell="nowrap" class="tabular-nums text-muted">{flow.version > 0 ? `v${flow.version}` : 'unpublished'}</td>
							<td data-cell="nowrap">
								{#if flow.last_run}
									<span class="flex items-center gap-2">
										<Badge tone={statusTone(flow.last_run.status)} size="sm">{flow.last_run.status}</Badge>
										<span class="text-xs text-muted" title={formatDateTime(flow.last_run.started_at)}>{relativeTime(flow.last_run.started_at)}</span>
									</span>
								{:else}
									<span class="text-xs text-faint">never</span>
								{/if}
							</td>
							<td>
								{#if canDelete(flow)}
									<Button
										variant="ghost"
										size="sm"
										onclick={() => askDelete(flow.id, flow.name)}
										title="Delete"
										aria-label="Delete {flow.name}"
									>
										<Trash2 size={ICON.sm} class="text-danger" />
									</Button>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</Table>

			<Pagination
				page={pageNumber(data.offset, data.limit)}
				perPage={data.limit}
				count={data.flows.length}
				total={data.total ?? undefined}
				hasNext={data.hasMore}
				noun="flows"
				href={pageHref('/admin/flows', data.limit, {
					...(data.status ? { status: data.status } : {}),
					...(data.q ? { q: data.q } : {}),
				})}
			/>
		{/if}
	</PageShell>

	<!-- The drawer asks for a name and derives the slug, and nothing else. A
	     template is a question for a reader who has a canvas to put it on, so
	     the editor asks it, from its empty state, beside the palette and the
	     import. -->
	<Drawer bind:open={showCreate} title="New flow">
		<form method="POST" action="?/create" id="flow-create-form" use:enhance={submit1.enhance} class="flex flex-col gap-4">
			<Input
				id="create-name"
				name="name"
				label="Name"
				value={createName}
				oninput={onNameInput}
				placeholder="Orders with shipments"
				required
			/>
			<Input
				id="create-slug"
				name="slug"
				label="Slug"
				hint="The URL segment: lower case letters, digits and underscores."
				bind:value={createSlug}
				oninput={() => (slugTouched = true)}
				required
			/>
		</form>
		{#snippet footer()}
			<Button variant="secondary" onclick={() => (showCreate = false)}>Cancel</Button>
			<Button variant="primary" type="submit" form="flow-create-form" loading={submit1.pending}>Create</Button>
		{/snippet}
	</Drawer>

	<Drawer bind:open={showImport} title="Import a flow">
		<form
			method="POST"
			action="?/import"
			id="flow-import-form"
			enctype="multipart/form-data"
			use:enhance={submit2.enhance}
			class="flex flex-col gap-4"
		>
			<FileInput
				id="import-file"
				name="file"
				label="Definition file"
				accept=".json,.yaml,.yml,application/json,application/yaml"
				hint="JSON or YAML, as exported from a flow."
			/>
			<Textarea
				id="import-text"
				name="text"
				label="Or paste the definition"
				rows={8}
				placeholder={'version: 1\nname: Orders with shipments'}
				mono
			/>
			<Select id="import-mode" name="mode" label="Mode" options={MODES} bind:value={importMode} />
			{#if importMode === 'replace'}
				<Input id="import-slug" name="slug" label="Slug of the flow to replace" required />
			{/if}
		</form>
		{#snippet footer()}
			<Button variant="secondary" onclick={() => (showImport = false)}>Cancel</Button>
			<Button variant="primary" type="submit" form="flow-import-form" loading={submit2.pending}>Import</Button>
		{/snippet}
	</Drawer>

	<form method="POST" action="?/delete" use:enhance bind:this={deleteForm} class="hidden">
		<input type="hidden" name="id" value={deleteId} />
	</form>
{:else}
	<PageShell title="Flows" width="wide">
		<NotEnabled
			title="Flows"
			description="The engine refused the flow routes."
		/>
	</PageShell>
{/if}
