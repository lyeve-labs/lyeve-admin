<script lang="ts">
	import PageTitle from '$lib/components/PageTitle.svelte';
	import {
		Alert,
		Badge,
		Button,
		Card,
		DescriptionList,
		Drawer,
		EmptyState,
		PageShell,
		Pagination,
		Input,
		Progress,
		SectionHeading,
		SegmentedControl,
		Select,
		Spinner,
		Stat,
		Table,
		confirm as confirmDialog,
		toast,
	} from '@lyeve-labs/ui-kit';
	import { enhance } from '$app/forms';
	import { goto, invalidate } from '$app/navigation';
	import { page } from '$app/state';
	import type { SubmitFunction } from '@sveltejs/kit';
	import {
		Ban,
		Download,
		FileText,
		Link,
		ListChecks,
		Pencil,
		Plus,
		RefreshCw,
		Rows3,
		Trash2,
		Undo2,
		Upload,
	} from '@lucide/svelte';
	import ImportWizard from '$lib/components/ImportWizard.svelte';
	import RefusalNotice from '$lib/components/RefusalNotice.svelte';
	import TransformField from '$lib/components/imports/TransformField.svelte';
	import { formRefusal } from '$lib/api/refusal';
	import { tracked } from '$lib/forms.svelte';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import {
		OUTCOME_LABELS,
		cancelable,
		outcome,
		outcomeTone,
		progress,
		rejectedHref,
		rejectionRate,
		rollbackable,
		emptyTransform,
		mappingTargets,
		transformDraft,
		transformFields,
		transformLabel,
		written,
		type FieldMapping,
		type ImportJob,
		type ImportMode,
		type MappingTemplate,
		type TransformDraft,
	} from '$lib/api/bulk-import';
	import { NO_VALUE, formatCount, formatDateTime } from '$lib/format';
	import type { ActionData, PageData } from './$types';
	import { pageHref, pageNumber } from '$lib/api/list';
	import { ICON } from '$lib/icon';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	/** How often the history re-reads while an import is still going. */
	const POLL_MS = 2000;

	const formError = $derived((form as { error?: string } | null)?.error ?? '');
	const refusal = $derived(formRefusal(form));
	const running = $derived(data.jobs.filter(cancelable));
	const rejecting = $derived(data.jobs.filter((j) => outcome(j) === 'partial' || outcome(j) === 'nothing'));

	// An import runs on the server. The history re-reads until none is left
	// running and then stops asking.
	$effect(() => {
		if (running.length === 0) return;
		const id = setInterval(() => void invalidate('app:imports'), POLL_MS);
		return () => clearInterval(id);
	});

	let refreshing = $state(false);
	async function refresh() {
		refreshing = true;
		try {
			await invalidate('app:imports');
		} finally {
			refreshing = false;
		}
	}

	let wizardOpen = $state(false);
	async function started(job: ImportJob) {
		toast.success(`Import of ${job.source_name} started`);
		await invalidate('app:imports');
	}

	function detailHref(id: string): string {
		const q = new URLSearchParams(page.url.searchParams);
		q.set('job', id);
		return `?${q}`;
	}
	let detailOpen = $state(false);
	$effect(() => {
		detailOpen = data.detail !== null;
	});
	function closeDetail() {
		const q = new URLSearchParams(page.url.searchParams);
		q.delete('job');
		void goto(`?${q}`, { replaceState: true, noScroll: true, keepFocus: true });
	}

	function cancel(j: ImportJob): SubmitFunction {
		return async ({ cancel: stop }) => {
			const confirmed = await confirmDialog(
				`Cancel the import of ${j.source_name}?`,
				'Rows already written stay written. Canceling stops the job where it is, it does not undo it.',
				{ confirmLabel: 'Cancel import' },
			);
			if (!confirmed) {
				stop();
				return;
			}
			return async ({ result, update }) => {
				await update();
				if (result.type === 'success') toast.success('Import canceled');
			};
		};
	}

	function rollback(j: ImportJob): SubmitFunction {
		return async ({ cancel: stop }) => {
			const confirmed = await confirmDialog(
				`Roll back the import of ${j.source_name}?`,
				`The ${formatCount(j.inserted_rows)} entries it created are deleted, with any edits made to them since. Entries it updated keep the imported values. The history of the import stays.`,
				{ confirmLabel: 'Roll back' },
			);
			if (!confirmed) {
				stop();
				return;
			}
			return async ({ result, update }) => {
				await update();
				if (result.type === 'success') toast.success('Import rolled back');
			};
		};
	}

	const detailItems = $derived(
		data.detail
			? [
					{ term: 'Content type', value: data.detail.job.content_type },
					{
						term: 'Source',
						value: `${data.detail.job.source_kind === 'url' ? 'Web address' : 'Upload'}, ${data.detail.job.source_format}`,
					},
					{
						term: 'When an entry exists',
						value: data.detail.job.mode === 'upsert' ? 'Update it' : 'Leave it alone',
					},
					{
						term: 'Key field',
						value:
							data.detail.job.upsert_key === 'entry.slug'
								? 'Entry slug'
								: data.detail.job.upsert_key || 'None',
					},
					{ term: 'Created', value: formatCount(data.detail.job.inserted_rows) },
					{ term: 'Updated', value: formatCount(data.detail.job.updated_rows) },
					{ term: 'Skipped', value: formatCount(data.detail.job.skipped_rows) },
					{ term: 'Rejected', value: formatCount(data.detail.job.errored_rows) },
				]
			: [],
	);
	// A mapping template: a saved mapping an import names instead of mapping
	// its columns again. Created and edited in a drawer, like any row.
	interface MappingRow {
		id: number;
		source: string;
		target: string;
		transform: TransformDraft;
	}

	let templateOpen = $state(false);
	let editingTemplate = $state<MappingTemplate | null>(null);
	let templateName = $state('');
	let templateType = $state('');
	let templateMode = $state<ImportMode>('create');
	let templateKey = $state('');
	let rows = $state<MappingRow[]>([]);
	let nextRow = 0;

	const templateTargets = $derived(
		mappingTargets(data.schemas.find((x) => x.name === templateType)?.fields ?? []),
	);
	const targetOptions = $derived(templateTargets.map((t) => ({ value: t.value, label: t.label })));

	/** The rows as the plugin takes them, or the first problem in words. */
	const templateMappings = $derived.by((): FieldMapping[] | string => {
		const out: FieldMapping[] = [];
		for (const r of rows) {
			if (!r.source.trim() && !r.target) continue;
			if (!r.source.trim() || !r.target) return 'Every row names a column in the file and the field it fills.';
			const fields = transformFields(r.transform);
			if (typeof fields === 'string') return `${r.source}: ${fields}`;
			const dataType = templateTargets.find((t) => t.value === r.target)?.dataType;
			out.push({ source_field: r.source.trim(), target_field: r.target, data_type: dataType, ...fields });
		}
		return out;
	});

	function addRow(source = '', target = '', transform: TransformDraft = emptyTransform()) {
		rows = [...rows, { id: nextRow++, source, target, transform }];
	}

	function openTemplate(t: MappingTemplate | null) {
		editingTemplate = t;
		templateName = t?.name ?? '';
		templateType = t?.content_type ?? (data.schemas.length === 1 ? data.schemas[0].name : '');
		templateMode = t?.mode === 'upsert' ? 'upsert' : 'create';
		templateKey = t?.upsert_key ?? '';
		rows = [];
		for (const m of t?.field_mappings ?? []) addRow(m.source_field, m.target_field, transformDraft(m));
		if (rows.length === 0) addRow();
		templateOpen = true;
	}

	const saveTemplate = tracked(() => {
		const subject = templateName;
		const verb = editingTemplate ? 'Saved' : 'Created';
		return async ({ result, update }) => {
			if (result.type !== 'failure') templateOpen = false;
			await update();
			if (result.type === 'success') toast.success(`${verb} ${subject}`);
		};
	});

	function removeTemplate(t: MappingTemplate): SubmitFunction {
		return async ({ cancel: stop }) => {
			const confirmed = await confirmDialog(
				`Delete the template ${t.name}?`,
				'Imports that already ran with it keep their history. Nothing else changes.',
				{ confirmLabel: 'Delete' },
			);
			if (!confirmed) {
				stop();
				return;
			}
			return async ({ result, update }) => {
				await update();
				if (result.type === 'success') toast.success(`Deleted ${t.name}`);
			};
		};
	}
</script>

<PageTitle title="Imports" />

<PageShell
	title="Imports"
	description="Bring content in from a file or another instance, and see what each import wrote and rejected."
	width="wide"
>
	{#snippet actions()}
		<Button variant="secondary" size="sm" onclick={refresh} loading={refreshing}>
			<RefreshCw size={ICON.sm} /> Refresh
		</Button>
		{#if data.gate.state === 'ok'}
			<Button variant="primary" size="sm" onclick={() => (wizardOpen = true)}>
				<Plus size={ICON.sm} /> New import
			</Button>
		{/if}
	{/snippet}

	{#if data.gate.state !== 'ok'}
		<GateNotice
			gate={data.gate}
			title="Imports"
			absent="The bulk import plugin is not part of this build, so content is created one entry at a time."
		/>
	{:else}
		{#if refusal}
			<RefusalNotice {refusal} />
		{:else if formError}
			<Alert tone="danger">{formError}</Alert>
		{/if}

		<div class="grid gap-4 lg:grid-cols-[3fr_2fr]">
			<Card>
				<div class="flex flex-col gap-3">
					<SectionHeading level={3}>How an import works</SectionHeading>
					<p class="text-sm text-muted">
						An import reads a file, matches its columns to the fields of one content type, and saves each
						row as an entry: the same entries the content screens edit, with their history, and the same
						ones an export writes out.
					</p>
					<p class="text-sm text-muted">
						A dry run comes first. It checks every row against the content type and reports which would be
						rejected and why, and writes nothing. A key field, such as the slug, decides whether a row is an
						entry that already exists: create only leaves that entry alone, create and update overwrites it.
					</p>
					<p class="text-sm text-muted">
						Every import stays in the history below with its counts. The rows it rejected can be downloaded
						with their reasons, fixed and imported again, and the entries it created can be rolled back.
					</p>
				</div>
			</Card>
			<Card>
				<div class="flex flex-col gap-3">
					<SectionHeading level={3}>Sources</SectionHeading>
					<ul class="flex flex-col gap-3">
						<li class="flex gap-3">
							<Upload size={ICON.md} class="mt-0.5 shrink-0 text-brand" />
							<div>
								<div class="text-sm text-fg">File upload</div>
								<div class="text-xs text-muted">
									CSV with a header row, an Excel workbook (XLSX), JSON, NDJSON or YAML, up to 50 MB.
								</div>
							</div>
						</li>
						<li class="flex gap-3">
							<Link size={ICON.md} class="mt-0.5 shrink-0 text-brand" />
							<div>
								<div class="text-sm text-fg">Web address</div>
								<div class="text-xs text-muted">
									An http or https link the engine fetches. Private and internal addresses are refused.
								</div>
							</div>
						</li>
						<li class="flex gap-3">
							<FileText size={ICON.md} class="mt-0.5 shrink-0 text-brand" />
							<div>
								<div class="text-sm text-fg">Another LyEve instance</div>
								<div class="text-xs text-muted">
									Its data export in JSON, NDJSON, YAML or CSV imports as it is, by file or by the signed
									download link. Entries keep their slug, title and status.
								</div>
							</div>
						</li>
					</ul>
				</div>
			</Card>
		</div>

		<div class="grid gap-4 sm:grid-cols-3">
			<Stat size="sm" mono label="Imports" value={formatCount(data.total ?? data.jobs.length)} />
			<Stat size="sm" mono label="Running" value={formatCount(running.length)} />
			<!-- A job completes having skipped every row it could not parse, so
			     the status alone says nothing about whether the content arrived. -->
			<Stat
				size="sm"
				mono
				label="Finished with rows rejected"
				value={formatCount(rejecting.length)}
				tone={rejecting.length > 0 ? 'warn' : 'neutral'}
			/>
		</div>

		<section class="flex flex-col gap-4">
			<div class="flex flex-wrap items-center justify-between gap-2">
				<SectionHeading level={2}>History</SectionHeading>
				{#if running.length > 0}
					<p class="flex items-center gap-2 text-xs text-muted" role="status">
						<Spinner size={ICON.xs} />
						{running.length === 1 ? 'One import is running.' : `${running.length} imports are running.`}
						The history follows it until it finishes.
					</p>
				{/if}
			</div>

			{#if data.jobs.length === 0}
				<EmptyState
					title="Nothing has been imported"
					description="Start one with New import. Each import appears here with what it wrote and what it rejected."
				>
					{#snippet iconSnippet()}
						<Upload size={ICON.lg} />
					{/snippet}
				</EmptyState>
			{:else}
				<Table label="Imports">
					<thead>
						<tr>
							<th scope="col">Source</th>
							<th scope="col">Outcome</th>
							<th scope="col">Created</th>
							<th scope="col">Updated</th>
							<th scope="col">Skipped</th>
							<th scope="col">Rejected</th>
							<th scope="col" class="text-right">Actions</th>
						</tr>
					</thead>
					<tbody>
						{#each data.jobs as j (j.id)}
							<tr>
								<td>
									<div class="flex items-center gap-2">
										<span class="max-w-56 truncate font-medium text-fg" title={j.source_name}
											>{j.source_name || 'Unnamed'}</span
										>
										{#if j.dry_run}
											<!-- A dry run wrote nothing. Reading its counts as
											     content that now exists is the other mistake
											     available on this page. -->
											<Badge tone="brand">Dry run, nothing written</Badge>
										{/if}
									</div>
									<div class="text-xs text-faint">
										{j.content_type} · {j.source_format}{j.source_kind === 'url' ? ' · web address' : ''}
										{#if j.mode === 'upsert'}· create and update{/if}
									</div>
									<div class="text-xs text-faint">{formatDateTime(j.created_at)}</div>
								</td>
								<td class="min-w-48">
									<div class="flex flex-col gap-1">
										<Badge tone={outcomeTone(outcome(j))} dot>{OUTCOME_LABELS[outcome(j)]}</Badge>
										{#if cancelable(j)}
											<Progress
												value={Math.round(progress(j) * 100)}
												size="sm"
												label="{formatCount(j.processed_rows)} of {formatCount(j.total_rows)} rows"
												animated={j.total_rows === 0}
											/>
										{/if}
										{#if j.error_message}
											<div class="max-w-xs truncate text-xs text-danger" title={j.error_message}>
												{j.error_message}
											</div>
										{/if}
									</div>
								</td>
								<td data-cell="nowrap" class="font-mono text-xs">{j.dry_run ? NO_VALUE : formatCount(j.inserted_rows)}</td>
								<td data-cell="nowrap" class="font-mono text-xs">{j.dry_run ? NO_VALUE : formatCount(j.updated_rows)}</td>
								<td data-cell="nowrap" class="font-mono text-xs">{formatCount(j.skipped_rows)}</td>
								<td data-cell="nowrap">
									<span class="font-mono text-xs">{formatCount(j.errored_rows)}</span>
									{#if rejectionRate(j) !== null && j.errored_rows > 0}
										<div class="text-xs text-faint">{rejectionRate(j)}% of rows read</div>
									{/if}
								</td>
								<td data-cell="nowrap">
									<div class="flex items-center justify-end gap-1">
										<Button
											variant="ghost"
											size="sm"
											href={detailHref(j.id)}
											aria-label="Rows of the import of {j.source_name}"
										>
											<ListChecks size={ICON.sm} />
										</Button>
										{#if j.errored_rows > 0}
											<Button
												variant="ghost"
												size="sm"
												href={rejectedHref(j.id)}
												aria-label="Download the rows rejected from {j.source_name}"
											>
												<Download size={ICON.sm} />
											</Button>
										{/if}
										{#if cancelable(j)}
											<form method="POST" action="?/cancel" use:enhance={cancel(j)}>
												<input type="hidden" name="id" value={j.id} />
												<Button variant="ghost" size="sm" type="submit" aria-label="Cancel the import of {j.source_name}">
													<Ban size={ICON.sm} />
												</Button>
											</form>
										{/if}
										{#if rollbackable(j)}
											<form method="POST" action="?/rollback" use:enhance={rollback(j)}>
												<input type="hidden" name="id" value={j.id} />
												<Button variant="ghost" size="sm" type="submit" aria-label="Roll back the import of {j.source_name}">
													<Undo2 size={ICON.sm} class="text-danger" />
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
					hasNext={data.hasMore}
					noun="imports"
					href={pageHref('/admin/imports', data.limit)}
				/>
			{/if}
		</section>
		<section class="flex flex-col gap-4" aria-label="Mapping templates">
			<div class="flex flex-wrap items-center justify-between gap-2">
				<SectionHeading level={2}>Mapping templates</SectionHeading>
				<Button variant="secondary" size="sm" onclick={() => openTemplate(null)}>
					<Plus size={ICON.sm} /> New template
				</Button>
			</div>
			<p class="text-sm text-muted">
				A template keeps a mapping, with its transforms, key and mode, so an import of the same kind of file
				chooses it rather than mapping each column again.
			</p>
			{#if data.licensed === false}
				<Alert tone="brand">
					Saving a template and the date, split and lookup transforms need a license this install does not hold.
					Templates already saved keep applying with their transforms, and deleting one is always allowed.
				</Alert>
			{/if}
			{#if !data.templatesRead}
				<Alert tone="danger">The templates could not be read. This is not a report that there are none.</Alert>
			{:else if data.templates.length === 0}
				<EmptyState title="No mapping template" description="Each import maps its columns from scratch.">
					{#snippet iconSnippet()}
						<Rows3 size={ICON.lg} />
					{/snippet}
				</EmptyState>
			{:else}
				<Table label="Mapping templates">
					<thead>
						<tr>
							<th scope="col">Template</th>
							<th scope="col">Content type</th>
							<th scope="col">Columns</th>
							<th scope="col">When an entry exists</th>
							<th scope="col"><span class="sr-only">Actions</span></th>
						</tr>
					</thead>
					<tbody>
						{#each data.templates as t (t.id)}
							<tr>
								<td class="font-medium text-fg">{t.name}</td>
								<td data-cell="nowrap" class="font-mono text-xs">{t.content_type || NO_VALUE}</td>
								<td class="text-xs text-muted">
									{t.field_mappings
										.map((m) => (m.transform ? `${m.source_field}, ${transformLabel(m).toLowerCase()}` : m.source_field))
										.join('; ')}
								</td>
								<td data-cell="nowrap" class="text-xs">
									{t.mode === 'upsert' ? `Update it, key ${t.upsert_key}` : 'Leave it alone'}
								</td>
								<td data-cell="nowrap">
									<div class="flex items-center justify-end gap-1">
										<Button variant="ghost" size="sm" aria-label="Edit {t.name}" onclick={() => openTemplate(t)}>
											<Pencil size={ICON.sm} />
										</Button>
										<form method="POST" action="?/deleteTemplate" use:enhance={removeTemplate(t)}>
											<input type="hidden" name="id" value={t.id} />
											<Button variant="ghost" size="sm" type="submit" aria-label="Delete {t.name}">
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

<ImportWizard
	bind:open={wizardOpen}
	schemas={data.schemas}
	templates={data.templates}
	licensed={data.licensed}
	onstarted={started}
/>

<Drawer bind:open={templateOpen} title={editingTemplate ? `Edit ${editingTemplate.name}` : 'New template'}>
	{#if refusal}
		<div class="mb-4"><RefusalNotice {refusal} /></div>
	{:else if formError}
		<div class="mb-4"><Alert tone="danger">{formError}</Alert></div>
	{/if}
	<form
		id="template-form"
		method="POST"
		action={editingTemplate ? '?/updateTemplate' : '?/createTemplate'}
		use:enhance={saveTemplate.enhance}
	>
		{#if editingTemplate}
			<input type="hidden" name="id" value={editingTemplate.id} />
		{/if}
		<input type="hidden" name="mappings" value={JSON.stringify(typeof templateMappings === 'string' ? [] : templateMappings)} />
		<div class="flex flex-col gap-4">
			<Input id="template-name" name="name" label="Name" bind:value={templateName} required />
			<Select
				id="template-type"
				name="content_type"
				label="Content type"
				searchable
				bind:value={templateType}
				options={data.schemas.map((x) => ({ value: x.name, label: x.name }))}
			/>
			<SegmentedControl
				label="When an entry already exists"
				name="mode"
				bind:value={templateMode}
				options={[
					{ value: 'create', label: 'Create only' },
					{ value: 'upsert', label: 'Create and update' },
				]}
			/>
			{#if templateMode === 'upsert'}
				<Select
					id="template-key"
					name="upsert_key"
					label="Key field"
					hint="The field that finds the entry a row updates."
					bind:value={templateKey}
					options={[
						{ value: '', label: 'Choose the key field' },
						{ value: 'entry.slug', label: 'Entry slug' },
						...templateTargets.filter((t) => !t.value.startsWith('entry.')).map((t) => ({ value: t.value, label: t.value })),
					]}
				/>
			{/if}
			<div class="flex flex-col gap-3">
				{#each rows as r, i (r.id)}
					<div class="flex flex-col gap-2 rounded border border-line p-3">
						<div class="grid items-end gap-2 sm:grid-cols-[1fr_1fr_auto]">
							<Input id="template-source-{r.id}" label="Column in the file" bind:value={r.source} />
							<Select
								id="template-target-{r.id}"
								label="Field"
								bind:value={r.target}
								options={[{ value: '', label: 'Choose a field' }, ...targetOptions]}
							/>
							<Button
								variant="ghost"
								size="sm"
								aria-label="Remove column {r.source || i + 1}"
								onclick={() => (rows = rows.filter((x) => x.id !== r.id))}
							>
								<Trash2 size={ICON.sm} class="text-danger" />
							</Button>
						</div>
						<TransformField
							id="template-{r.id}"
							label="Transform"
							licensed={data.licensed}
							bind:draft={r.transform}
						/>
					</div>
				{/each}
				<div>
					<Button variant="secondary" size="sm" onclick={() => addRow()}>
						<Plus size={ICON.sm} /> Add column
					</Button>
				</div>
				{#if typeof templateMappings === 'string'}
					<p class="text-xs text-danger">{templateMappings}</p>
				{/if}
			</div>
		</div>
	</form>
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (templateOpen = false)}>Cancel</Button>
		<Button
			variant="primary"
			type="submit"
			form="template-form"
			disabled={typeof templateMappings === 'string'}
			loading={saveTemplate.pending}
		>
			{editingTemplate ? 'Save' : 'Create'}
		</Button>
	{/snippet}
</Drawer>

<Drawer
	bind:open={detailOpen}
	title={data.detail ? `Import of ${data.detail.job.source_name}` : 'Import'}
	description={data.detail ? OUTCOME_LABELS[outcome(data.detail.job)] : ''}
	onclose={closeDetail}
>
	{#if data.detail}
		<div class="flex flex-col gap-5">
			<DescriptionList items={detailItems} />
			<div class="flex flex-col gap-3">
				<div class="flex flex-wrap items-center justify-between gap-2">
					<SectionHeading level={3}>Rejected rows</SectionHeading>
					{#if data.detail.rejectedTotal > 0}
						<Button variant="secondary" size="sm" href={rejectedHref(data.detail.job.id)}>
							<Download size={ICON.sm} /> Download all {formatCount(data.detail.rejectedTotal)} as CSV
						</Button>
					{/if}
				</div>
				{#if data.detail.rejected.length === 0}
					<p class="text-sm text-muted">No row was rejected.</p>
				{:else}
					<Table label="Rejected rows of this import">
						<thead>
							<tr>
								<th scope="col">Row</th>
								<th scope="col">Why</th>
							</tr>
						</thead>
						<tbody>
							{#each data.detail.rejected as r (r.id)}
								<tr>
									<td data-cell="nowrap" class="font-mono text-xs">{r.row_index + 1}</td>
									<td class="text-xs">
										{r.error_message || r.error_code}
										{#if r.error_code}<span class="text-faint"> ({r.error_code})</span>{/if}
									</td>
								</tr>
							{/each}
						</tbody>
					</Table>
					{#if data.detail.rejectedTotal > data.detail.rejected.length}
						<p class="text-xs text-muted">
							The first {formatCount(data.detail.rejected.length)} of {formatCount(data.detail.rejectedTotal)}. The
							download has them all.
						</p>
					{/if}
				{/if}
			</div>
			{#if data.detail.skipped.length > 0}
				<div class="flex flex-col gap-3">
					<SectionHeading level={3}>Skipped rows</SectionHeading>
					<Table label="Skipped rows of this import">
						<thead>
							<tr>
								<th scope="col">Row</th>
								<th scope="col">Why</th>
							</tr>
						</thead>
						<tbody>
							{#each data.detail.skipped as r (r.id)}
								<tr>
									<td data-cell="nowrap" class="font-mono text-xs">{r.row_index + 1}</td>
									<td class="text-xs">{r.error_message || 'Skipped'}</td>
								</tr>
							{/each}
						</tbody>
					</Table>
				</div>
			{/if}
		</div>
	{/if}
	{#snippet footer()}
		<Button variant="secondary" onclick={closeDetail}>Close</Button>
	{/snippet}
</Drawer>
