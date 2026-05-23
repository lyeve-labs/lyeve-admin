<script lang="ts">
	import PageTitle from '$lib/components/PageTitle.svelte';
	import FormErrors from '$lib/components/FormErrors.svelte';
	import OlderHidden from '$lib/components/OlderHidden.svelte';
	import { Badge, Breadcrumb, Button, Card, PageShell, SectionHeading } from '@lyeve-labs/ui-kit';
	import type { PageData, ActionData } from './$types';
	import type { SchemaField } from '@lyeve-labs/client';
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { Clock, Eye, EyeOff, History, RotateCcw } from '@lucide/svelte';
	import { crumbsAfter } from '$lib/breadcrumb';
	import { listBack } from '$lib/back';
	import { buildFromData, validate, serialize, extractM2MRelations } from '$lib/utils/content-form';
	import { entryTitle, shortId } from '$lib/utils/entry-identity';
	import { formatDateTime } from '$lib/format';
	import ContentForm from '$lib/components/ContentForm.svelte';
	import TranslationsPanel from '$lib/components/TranslationsPanel.svelte';
	import ReviewBar from '$lib/components/ReviewBar.svelte';
	import CommentsPanel from '$lib/components/content/CommentsPanel.svelte';
	import AddToRelease from '$lib/components/content/AddToRelease.svelte';
	import { formRefusal } from '$lib/api/refusal';
	import { ICON } from '$lib/icon';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let userFields = $derived((data.schemaDef?.fields ?? []).filter((f: SchemaField) => !f.system));

	// Pre-fill from the loaded item.
	// svelte-ignore state_referenced_locally
	let formValues = $state<Record<string, unknown>>(
		buildFromData(data.schemaDef?.fields ?? [], data.item?.data ?? {}),
	);

	// Every action on this page redirects back to this same route, which swaps
	// `data` without remounting, so a one-time initializer would go on showing
	// the pre-action values and restore would appear to do nothing. Plain
	// variable, not $state, so the effect does not depend on what it writes.
	// svelte-ignore state_referenced_locally
	let seededVersion = `${data.item?.id}:${data.item?.updated_at}`;
	$effect(() => {
		const version = `${data.item?.id}:${data.item?.updated_at}`;
		if (version === seededVersion) return;
		seededVersion = version;
		formValues = buildFromData(data.schemaDef?.fields ?? [], data.item?.data ?? {});
	});
	let validationErrors = $state<Record<string, string>>({});
	let submitting = $state(false);

	let serialized = $derived(serialize(userFields, formValues));
	let m2mRelations = $derived(
		JSON.stringify(
			Object.fromEntries(
				extractM2MRelations(userFields, formValues).map((r) => [r.fieldName, r.ids]),
			),
		),
	);

	function handleSubmit(e: SubmitEvent) {
		const errors = validate(userFields, formValues);
		if (Object.keys(errors).length > 0) {
			e.preventDefault();
			validationErrors = errors;
		}
	}

	let schemaName = $derived(data.schemaDef?.name ?? '');
	let schemaLabel = $derived(data.schemaDef?.display_name || schemaName);
	// The list forwards its page on the row link, so the way back lands on
	// the page the reader left rather than on the first.
	let back = $derived(listBack(`/admin/content/${schemaName}`, schemaLabel, page.url, ['limit', 'offset']));
	let entryId = $derived(data.item?.id ?? '');

	// The heading names the entry the author named, not the first eight
	// characters of its id. The full id stays in the description, where it is
	// the thing an operator copies into a query.
	let resolved = $derived(
		data.item ? entryTitle(data.item, userFields) : { label: '', source: 'none' as const },
	);
	let heading = $derived(resolved.source === 'none' ? 'Untitled entry' : resolved.label);

	let itemStatus = $derived((data.item?.data?._status as string) ?? 'published');
	let isPublished = $derived(itemStatus === 'published');

	// History panel
	let showHistory = $state(false);
	let selectedRev = $state<string | null>(null);

	type Revision = {
		id: string;
		revision_num: number;
		data: Record<string, unknown>;
		created_by: string;
		created_at: string;
	};
	let revisions = $derived((data.revisions ?? []) as Revision[]);

	// The plugin lists only the revisions this install reads, and says how
	// many older ones it left out and over what window. Both numbers are its
	// own, so the panel states no window of its own.
	let hiddenOlder = $derived(data.revisionWindow?.hiddenOlder ?? 0);
	let windowDays = $derived(data.revisionWindow?.windowDays ?? null);
	let olderHidden = $derived(hiddenOlder > 0 && windowDays !== null);
	// The revision just older than the oldest listed. Opening it is how the
	// panel asks, and the plugin answers 402 when it is outside the window.
	let nextOlder = $derived(
		revisions.length > 0 ? Math.min(...revisions.map((r) => r.revision_num)) - 1 : 0,
	);

	// A refusal from opening or restoring a revision stays in the panel.
	let revisionError = $derived(form && 'revision' in form && form.revision === true ? (form.error ?? '') : '');
	let revisionRefusal = $derived(revisionError ? formRefusal(form) : null);
	let openedRevision = $derived(
		form && 'openedRevision' in form && form.openedRevision ? (form.openedRevision as Revision) : null,
	);
	$effect(() => {
		if (revisionError || openedRevision) showHistory = true;
	});

	// A refusal from a translation action names its locale. The entry form's
	// own refusal does not, and each panel shows only its own.
	let translationError = $derived(
		form && 'translationLocale' in form && typeof form.translationLocale === 'string'
			? { message: form.error ?? '', locale: form.translationLocale }
			: null,
	);

	// A refusal from a review action stays in the bar, with the status the
	// engine gave it, so a 403 reads as a rule rather than a broken save.
	let reviewError = $derived(
		form && 'review' in form && form.review === true
			? { message: form.error ?? '', status: typeof form.reviewStatus === 'number' ? form.reviewStatus : 0 }
			: null,
	);

	// The comments panel and the release card each show only their own
	// refusal, and neither reaches the entry form.
	let commentError = $derived(form && 'comments' in form && form.comments === true ? (form.error ?? '') : '');
	let releaseError = $derived(form && 'release' in form && form.release === true ? (form.error ?? '') : '');
	let sideRefusal = $derived(commentError || releaseError ? formRefusal(form) : null);

	function formatDate(iso: string) {
		return formatDateTime(iso);
	}

	function revDiff(rev: Revision): string {
		const keys = Object.keys(rev.data ?? {}).filter((k) => !['_status', '_locale'].includes(k));
		const shown = keys.slice(0, 3).join(', ');
		return keys.length > 3 ? `${shown} and ${keys.length - 3} more` : shown;
	}
</script>

<PageTitle title={heading} />

<PageShell title={heading} description={entryId} width="wide" {back}>
	{#snippet breadcrumb()}
		<Breadcrumb
			items={crumbsAfter(back, [
				{ label: 'Content', href: '/admin/content' },
				{ label: schemaLabel, href: `/admin/content/${schemaName}` },
				{ label: heading },
			])}
		/>
	{/snippet}

	{#snippet actions()}
		<div class="flex flex-col items-end gap-2">
			{#if data.schemaDef?.with_draft_publish}
				<div class="flex items-center gap-2">
					<Badge tone={isPublished ? 'success' : 'warn'}>{itemStatus}</Badge>
					{#if isPublished}
						<form method="POST" action="?/unpublish" use:enhance>
							<Button variant="secondary" size="sm" type="submit">
								<EyeOff size={ICON.sm} /> Unpublish
							</Button>
						</form>
					{:else}
						<form method="POST" action="?/publish" use:enhance>
							<Button variant="primary" size="sm" type="submit">
								<Eye size={ICON.sm} /> Publish
							</Button>
						</form>
					{/if}
				</div>
			{/if}
			<div class="flex items-center gap-2">
				{#if revisions.length > 0 || hiddenOlder > 0}
					<Button
						variant="ghost"
						size="sm"
						type="button"
						onclick={() => (showHistory = !showHistory)}
					>
						<History size={ICON.sm} /> History ({revisions.length})
					</Button>
				{/if}
				<div class="flex flex-col items-end gap-1 text-xs text-faint">
					<span class="flex items-center gap-1">
						<Clock size={ICON.xs} /> Created {formatDate(data.item?.created_at ?? '')}
					</span>
					{#if data.schemaDef?.with_updated_at}
						<span class="flex items-center gap-1">
							<Clock size={ICON.xs} /> Updated {formatDate(data.item?.updated_at ?? '')}
						</span>
					{/if}
				</div>
			</div>
		</div>
	{/snippet}

	<div class="flex items-start gap-5">
		<div class="min-w-0 flex-1">
			{#if data.review}
				<div class="mb-5">
					<ReviewBar
						entryId={entryId}
						assignment={data.review.assignment}
						stages={data.review.stages}
						definitions={data.review.definitions}
						approvalsNeeded={data.review.approvalsNeeded}
						userId={data.review.userId}
						unavailable={data.review.unavailable}
						forbidden={data.review.forbidden}
						error={reviewError?.message}
						errorStatus={reviewError?.status}
					/>
				</div>
			{/if}

			<form
				method="POST"
				action="?/save"
				use:enhance={() => {
					submitting = true;
					return async ({ update }) => {
						submitting = false;
						await update();
					};
				}}
				onsubmit={handleSubmit}
				class="flex flex-col gap-5"
			>
				<input type="hidden" name="data" value={serialized} />
				<input type="hidden" name="m2m_relations" value={m2mRelations} />

				<Card>
					<div class="flex flex-col gap-5">
						<ContentForm
							fields={userFields}
							{formValues}
							{validationErrors}
							relationItems={data.relationItems}
				mediaChoices={data.mediaChoices}
							error={translationError || reviewError || commentError || releaseError || revisionError ? null : form?.error}
						/>
					</div>
				</Card>

				<div class="flex justify-end">
					<Button type="submit" loading={submitting}>Save</Button>
				</div>
			</form>

			{#if data.releases}
				<div class="mt-5">
					<AddToRelease
						releases={data.releases.open}
						holding={data.releases.holding}
						error={releaseError || undefined}
						refused={releaseError ? sideRefusal : null}
						added={!!form && 'addedToRelease' in form}
					/>
				</div>
			{/if}

			{#if data.comments}
				<div class="mt-5">
					<CommentsPanel
						threads={data.comments.threads}
						people={data.comments.people}
						unavailable={data.comments.unavailable}
						error={commentError || undefined}
						refused={commentError ? sideRefusal : null}
					/>
				</div>
			{/if}

			{#if data.localization}
				<div class="mt-5">
					<TranslationsPanel
						fields={userFields}
						locales={data.localization.locales}
						translations={data.localization.translations}
						unavailable={data.localization.unavailable}
						error={translationError?.message}
						errorLocale={translationError?.locale}
					/>
				</div>
			{/if}
		</div>

		{#if showHistory}
			<aside data-testid="revision-history" class="w-64 shrink-0">
				<Card pad="none">
					{#snippet header()}
						<SectionHeading level={3}>Revision history</SectionHeading>
					{/snippet}
					<ul class="max-h-96 divide-y divide-line overflow-y-auto">
						{#each revisions as rev (rev.id)}
							<li class="px-4 py-3 {selectedRev === rev.id ? 'bg-surface-2/60' : ''}">
								<button
									type="button"
									class="w-full rounded text-left outline-none focus-visible:ring-2
										focus-visible:ring-brand"
									onclick={() => (selectedRev = selectedRev === rev.id ? null : rev.id)}
								>
									<span class="block text-xs text-fg">{formatDate(rev.created_at)}</span>
									<span class="mt-0.5 block truncate text-xs text-faint">{revDiff(rev)}</span>
								</button>
								{#if selectedRev === rev.id}
									<form method="POST" action="?/restore" use:enhance class="mt-2">
										<input type="hidden" name="rev_num" value={rev.revision_num} />
										<Button variant="secondary" size="sm" type="submit">
											<RotateCcw size={ICON.xs} /> Restore
										</Button>
									</form>
								{/if}
							</li>
						{/each}
					</ul>
					{#if openedRevision}
						<div class="border-t border-line px-4 py-3" data-testid="opened-revision">
							<p class="text-xs font-medium text-fg">Revision {openedRevision.revision_num}</p>
							<p class="mt-0.5 text-xs text-faint">{formatDate(openedRevision.created_at)}</p>
							<p class="mt-0.5 truncate text-xs text-faint">{revDiff(openedRevision)}</p>
							<form method="POST" action="?/restore" use:enhance class="mt-2">
								<input type="hidden" name="rev_num" value={openedRevision.revision_num} />
								<Button variant="secondary" size="sm" type="submit">
									<RotateCcw size={ICON.xs} /> Restore
								</Button>
							</form>
						</div>
					{/if}
					{#if olderHidden || revisionError}
						<div class="flex flex-col gap-3 border-t border-line p-3">
							{#if olderHidden}
								<OlderHidden count={hiddenOlder} noun="revisions" {windowDays}>
									{#if nextOlder > 0 && !openedRevision}
										<form method="POST" action="?/openRevision" use:enhance>
											<input type="hidden" name="rev_num" value={nextOlder} />
											<Button variant="secondary" size="sm" type="submit">Open revision {nextOlder}</Button>
										</form>
									{/if}
								</OlderHidden>
							{/if}
							{#if revisionError}
								<FormErrors message={revisionError} refused={revisionRefusal} />
							{/if}
						</div>
					{/if}
				</Card>
			</aside>
		{/if}
	</div>
</PageShell>
