<script lang="ts">
	import {
		Alert,
		Badge,
		Button,
		Card,
		EmptyState,
		PageShell,
		Pagination,
		Progress,
		SectionHeading,
		Spinner,
		Stat,
		Table,
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
	import FormErrors from '$lib/components/FormErrors.svelte';
	import { formRefusal } from '$lib/api/refusal';
	import { confirmed } from '$lib/forms.svelte';
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
		transformLabel,
		type ImportJob,
		type MappingTemplate,
	} from '$lib/api/bulk-import';
	import { NO_VALUE, formatCount, formatDateTime } from '$lib/format';
	import type { ActionData, PageData } from './$types';
	import { pageHref, pageNumber } from '$lib/api/list';
	import { ICON } from '$lib/icon';
	import ImportRowsDrawer from './ImportRowsDrawer.svelte';
	import TemplateDrawer from './TemplateDrawer.svelte';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	/** How often the history re-reads while an import is still going. */
	const POLL_MS = 2000;

	// Every form on this page reports through one result, so each failure is
	// tagged with its action. The template drawer shows only its own, the page
	// shows the rest, and a drawer opened after a failure starts clean.
	let setAside = $state<unknown>(null);
	const failure = $derived(form && form !== setAside && 'error' in form ? form : null);
	const inDrawer = $derived(failure?.action === 'saveTemplate');
	const formError = $derived(failure && !inDrawer ? String(failure.error ?? '') : '');
	const refusal = $derived(failure && !inDrawer ? formRefusal(failure) : null);
	const templateError = $derived(inDrawer ? String(failure?.error ?? '') : '');
	const templateRefusal = $derived(inDrawer ? formRefusal(failure) : null);
	// Null while the content types are unread, so each place that offers one
	// says why it offers none.
	const schemaList = $derived(data.schemas.ok ? data.schemas.value : null);
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
		return confirmed(
			`Cancel the import of ${j.source_name}?`,
			'Rows already written stay written. Canceling stops the job where it is, it does not undo it.',
			{ confirmLabel: 'Cancel import', success: 'Import canceled' },
		);
	}

	function rollback(j: ImportJob): SubmitFunction {
		return confirmed(
			`Roll back the import of ${j.source_name}?`,
			`The ${formatCount(j.inserted_rows)} entries it created are deleted, with any edits made to them since. Entries it updated keep the imported values. The history of the import stays.`,
			{ confirmLabel: 'Roll back', success: 'Import rolled back' },
		);
	}

	// The drawer owns its fields. The page sets the old failure aside first,
	// so a drawer opened after a failure starts clean.
	let templateDrawer = $state<TemplateDrawer>();

	function openTemplate(t: MappingTemplate | null) {
		setAside = form;
		templateDrawer?.edit(t);
	}

	function removeTemplate(t: MappingTemplate): SubmitFunction {
		return confirmed(
			`Delete template ${t.name}`,
			'Imports that already ran with it keep their history. Nothing else changes.',
			{ confirmLabel: 'Delete', success: `Deleted ${t.name}` },
		);
	}
</script>

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
			level={2}
			gate={data.gate}
			title="Imports"
			absent="The bulk import plugin is not part of this build, so content is created one entry at a time."
		/>
	{:else}
		<FormErrors message={formError} refused={refusal} />

		<div class="grid gap-4 lg:grid-cols-[3fr_2fr]">
			<Card>
				<div class="flex flex-col gap-3">
					<SectionHeading level={2}>How an import works</SectionHeading>
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
					<SectionHeading level={2}>Sources</SectionHeading>
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
					description="Each import appears here with what it wrote and what it rejected."
				>
					{#snippet iconSnippet()}
						<Upload size={ICON.lg} />
					{/snippet}
					{#snippet action()}
						<Button variant="secondary" onclick={() => (wizardOpen = true)}><Plus size={ICON.sm} /> New import</Button>
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
										<div class="text-xs text-faint">
											{rejectionRate(j)}% of the {formatCount(j.processed_rows)}
											{j.processed_rows === 1 ? 'row' : 'rows'} read
										</div>
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
				{#if data.templatesRead && data.templates.length > 0}
					<Button variant="secondary" size="sm" onclick={() => openTemplate(null)}>
						<Plus size={ICON.sm} /> New template
					</Button>
				{/if}
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
				<GateNotice
					gate={data.templatesGate ?? { state: 'error', message: 'The templates could not be read. This is not a report that there are none.' }}
					title="Templates"
					absent="This build does not keep mapping templates."
				/>
			{:else if data.templates.length === 0}
				<EmptyState title="No mapping template" description="Each import maps its columns from scratch.">
					{#snippet iconSnippet()}
						<Rows3 size={ICON.lg} />
					{/snippet}
					{#snippet action()}
						<Button variant="secondary" onclick={() => openTemplate(null)}><Plus size={ICON.sm} /> New template</Button>
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
	schemas={schemaList}
	templates={data.templates}
	licensed={data.licensed}
	onstarted={started}
/>

<TemplateDrawer
	bind:this={templateDrawer}
	schemas={schemaList}
	licensed={data.licensed}
	error={templateError}
	refused={templateRefusal}
/>

<ImportRowsDrawer bind:open={detailOpen} detail={data.detail} onclose={closeDetail} />
