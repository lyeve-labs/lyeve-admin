<script lang="ts">
	import PageTitle from '$lib/components/PageTitle.svelte';
	import {
		Alert,
		Badge,
		Button,
		Card,
		EmptyState,
		CheckboxGroup,
		CopyButton,
		Drawer,
		Input,
		NumberInput,
		PageShell,
		SearchInput,
		SectionHeading,
		Stat,
		confirm as confirmDialog,
	} from '@lyeve-labs/ui-kit';
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { PageData, ActionData } from './$types';
	import { ArrowRight, Trash2 } from '@lucide/svelte';
	import ListToolbar from '$lib/components/ListToolbar.svelte';
	import { ICON } from '$lib/icon';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let publicChoice = $state<string[]>([]);
	$effect.pre(() => {
		publicChoice = [...(data.publicSchemas ?? [])];
	});
	const savePublic: SubmitFunction = () => async ({ update }) => {
		await update({ reset: false });
	};

	const synFields = $derived((form as { fields?: Record<string, string> } | null)?.fields ?? {});
	let synonymOpen = $state(false);
	let baseTerm = $state('');
	let terms = $state('');
	const saveSynonym: SubmitFunction = () => async ({ result, update }) => {
		if (result.type === 'success') {
			synonymOpen = false;
			baseTerm = '';
			terms = '';
		}
		await update({ reset: false });
	};

	function confirmDelete(term: string): SubmitFunction {
		return async ({ cancel }) => {
			const ok = await confirmDialog(`Delete the synonyms of ${term}?`, 'Searches for it match only the term itself again.', {
				confirmLabel: 'Delete',
			});
			if (!ok) cancel();
		};
	}

	// Seed the input with the active query so it survives navigation.
	// svelte-ignore state_referenced_locally
	let query = $state(data.q);
</script>

<PageTitle title="Search" />

<PageShell
	title="Search"
	description="Full-text search over content entries, what anyone may search on your site, and how results rank."
	width="wide"
>
	<!-- A native GET form re-runs the server load with ?q=, so a result page
	     has a URL that can be shared and reloaded. -->
	<form method="GET">
		<ListToolbar label="Search content">
			{#snippet search()}
				<div class="flex items-center gap-2">
					<label for="content-search" class="sr-only">Search content</label>
					<SearchInput id="content-search" name="q" bind:value={query} placeholder="Search content" class="min-w-0 flex-1" />
					<Button type="submit" variant="secondary">Search</Button>
				</div>
			{/snippet}
		</ListToolbar>
	</form>

	<div class="grid grid-cols-1 gap-6 lg:grid-cols-3">
		<div class="lg:col-span-2">
			{#if data.q === ''}
				<EmptyState
					title="Search the content library"
					description="Enter a query above to search."
				/>
			{:else if data.searchFailed}
				<Alert tone="danger" title="Search failed">
					The search service did not respond. Try again in a moment.
				</Alert>
			{:else if data.results.length === 0}
				<EmptyState
					title={`No results for "${data.q}".`}
					description="Try a broader term, or check the spelling."
				/>
			{:else}
				<div class="space-y-3">
					<p class="text-xs tracking-wider text-faint uppercase">
						{data.results.length} result{data.results.length === 1 ? '' : 's'} for "{data.q}"
					</p>
					<ul class="space-y-3">
						{#each data.results as hit (hit.entry_id)}
							<li>
								<Card pad="sm">
									<div class="flex items-start justify-between gap-3">
										<h3 class="text-sm font-medium text-fg">
											{hit.title || hit.slug || '(untitled)'}
										</h3>
										<span class="shrink-0 text-xs text-faint tabular-nums">
											rank {hit.rank.toFixed(3)}
										</span>
									</div>
									<div class="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted">
										<Badge>{hit.schema}</Badge>
										<Badge>{hit.status}</Badge>
										{#if hit.slug}<span class="text-faint">/{hit.slug}</span>{/if}
									</div>
									{#if hit.snippets}
										{#each Object.entries(hit.snippets) as [field, snippet]}
											<p class="mt-2 text-xs text-muted">
												<span class="text-faint">{field}</span>
												{snippet}
											</p>
										{/each}
									{/if}
									{#if hit.tags && hit.tags.length}
										<div class="mt-2 flex flex-wrap gap-1">
											{#each hit.tags as tag}
												<Badge size="sm">{tag}</Badge>
											{/each}
										</div>
									{/if}
								</Card>
							</li>
						{/each}
					</ul>
				</div>
			{/if}
		</div>

		<aside class="space-y-6">
			<Card pad="sm">
				{#snippet header()}
					<SectionHeading level={3}>Public search</SectionHeading>
				{/snippet}
				{#if data.publicSchemas === null}
					<Alert tone="warn">The public schema list could not be read.</Alert>
				{:else if data.schemas.length === 0}
					<p class="text-sm text-muted">No schemas yet.</p>
				{:else}
					<form method="POST" action="?/publicSchemas" class="flex flex-col gap-3" use:enhance={savePublic}>
						{#if form?.publicError}
							<Alert tone="danger">{form.publicError}</Alert>
						{:else if form && 'publicSaved' in form}
							<Alert tone="success" autoDismiss>Saved.</Alert>
						{/if}
						<CheckboxGroup
							name="schemas"
							label="Anyone may search"
							hint="Published entries of a ticked schema answer on your site's own host with no credential: title, slug, tags and a snippet, never the stored body."
							options={data.schemas.map((n) => ({ value: n, label: n }))}
							bind:value={publicChoice}
						/>
						{#if publicChoice.length > 0}
							<div class="flex items-start gap-1">
								<code class="min-w-0 flex-1 break-all text-xs text-muted">GET /api/v1/search/{publicChoice[0]}?q=kettle</code>
								<CopyButton value={`/api/v1/search/${publicChoice[0]}?q=kettle`} label="Copy the request" class="shrink-0" />
							</div>
						{/if}
						<div><Button variant="primary" size="sm" type="submit">Save</Button></div>
					</form>
				{/if}
			</Card>

			<Card pad="sm">
				{#snippet header()}
					<SectionHeading level={3}>Ranking weights</SectionHeading>
				{/snippet}
				<form method="POST" action="?/ranking" class="flex flex-col gap-3" use:enhance>
					{#if form?.rankingError}
						<Alert tone="danger">{form.rankingError}</Alert>
					{:else if form && 'rankingSaved' in form}
						<Alert tone="success" autoDismiss>Saved.</Alert>
					{/if}
					<p class="text-xs text-muted">How much a match in each field counts, for every schema with no weights of its own.</p>
					<NumberInput id="w-title" name="title_weight" label="Title" min={0} max={10} step={0.1} value={data.ranking.title_weight} />
					<NumberInput id="w-body" name="body_weight" label="Body" min={0} max={10} step={0.1} value={data.ranking.body_weight} />
					<NumberInput id="w-tag" name="tag_weight" label="Tags" min={0} max={10} step={0.1} value={data.ranking.tag_weight} />
					<div><Button variant="primary" size="sm" type="submit">Save</Button></div>
				</form>
			</Card>

			<Card pad="sm">
				{#snippet header()}
					<div class="flex items-center justify-between gap-2">
						<SectionHeading level={3}>Synonyms</SectionHeading>
						<Button variant="secondary" size="sm" onclick={() => (synonymOpen = true)}>New synonym</Button>
					</div>
				{/snippet}
				{#if form?.synonymError && !synonymOpen}
					<Alert tone="danger">{form.synonymError}</Alert>
				{/if}
				{#if data.synonyms.length === 0}
					<p class="text-sm text-muted">No synonym groups configured.</p>
				{:else}
					<ul class="space-y-2 text-xs">
						{#each data.synonyms as group (group.id)}
							<li class="flex items-center gap-1.5">
								<span class="font-medium text-muted">{group.base_term}</span>
								<ArrowRight size={ICON.xs} class="shrink-0 text-faint" />
								<span class="min-w-0 flex-1 text-muted">{group.synonyms.join(', ')}</span>
								<form method="POST" action="?/deleteSynonym" use:enhance={confirmDelete(group.base_term)}>
									<input type="hidden" name="id" value={group.id} />
									<Button variant="ghost" size="sm" type="submit" aria-label="Delete the synonyms of {group.base_term}">
										<Trash2 size={ICON.sm} class="text-danger" />
									</Button>
								</form>
							</li>
						{/each}
					</ul>
				{/if}
			</Card>

			<Card pad="sm">
				{#snippet header()}
					<SectionHeading level={3}>Last 30 days</SectionHeading>
				{/snippet}
				{#if data.analytics === null}
					<p class="text-sm text-muted">Search analytics could not be read.</p>
				{:else}
					<div class="grid grid-cols-2 gap-3">
						<Stat size="sm" mono label="Searches" value={data.analytics.total_searches} />
						<Stat size="sm" mono label="No results" value={`${data.analytics.zero_result_pct.toFixed(1)}%`} />
					</div>
					{#if data.analytics.top_queries.length > 0}
						<ul class="mt-3 space-y-1 text-xs">
							{#each data.analytics.top_queries.slice(0, 10) as tq (tq.query_text)}
								<li class="flex justify-between gap-2 text-muted">
									<span class="truncate">{tq.query_text}</span>
									<span class="tabular-nums text-faint">{tq.count}</span>
								</li>
							{/each}
						</ul>
					{/if}
				{/if}
			</Card>

			{#if data.canReindex}
				<Card pad="sm">
					{#snippet header()}
						<SectionHeading level={3}>Index</SectionHeading>
					{/snippet}
					<form method="POST" action="?/reindex" class="flex flex-col gap-3" use:enhance>
						{#if form?.reindexError}
							<Alert tone="danger">{form.reindexError}</Alert>
						{:else if form && 'reindexed' in form}
							<Alert tone="success" autoDismiss>{form.reindexMessage || `Rebuilt ${form.reindexed} entries.`}</Alert>
						{/if}
						<p class="text-xs text-muted">Rebuilds the index from every entry. Entries are indexed as they are saved, so this is for recovering from a change made behind the engine's back.</p>
						<div><Button variant="secondary" size="sm" type="submit">Rebuild index</Button></div>
					</form>
				</Card>
			{/if}
		</aside>
	</div>
</PageShell>

<Drawer bind:open={synonymOpen} title="New synonym">
	<form method="POST" action="?/createSynonym" id="synonym-form" class="flex flex-col gap-4" use:enhance={saveSynonym}>
		{#if form?.synonymError && synonymOpen}
			<Alert tone="danger">{form.synonymError}</Alert>
		{/if}
		<Input id="syn-base" name="base_term" label="Term" required hint="A search for exactly this term also matches the terms below." bind:value={baseTerm} error={synFields.base_term} />
		<Input id="syn-terms" name="synonyms" label="Also matches" required hint="Separated by commas." bind:value={terms} error={synFields.synonyms} />
	</form>
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (synonymOpen = false)}>Cancel</Button>
		<Button variant="primary" type="submit" form="synonym-form">Create</Button>
	{/snippet}
</Drawer>
