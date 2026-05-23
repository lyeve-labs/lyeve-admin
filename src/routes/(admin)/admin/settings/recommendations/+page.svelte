<script lang="ts">
	import PageTitle from '$lib/components/PageTitle.svelte';
	import {
		Alert,
		Autocomplete,
		Badge,
		Button,
		Card,
		CopyButton,
		EmptyState,
		Input,
		PageShell,
		SectionHeading,
		Stat,
		Table,
	} from '@lyeve-labs/ui-kit';
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { RefreshCw, Sparkles, UserSearch } from '@lucide/svelte';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import {
		hasUsers,
		percent,
		score,
		sourceLabel,
		sourceTone,
		splitIsSkewed,
		took,
		type FeedEntry,
		INTEGRATION_EXAMPLE,
	} from '$lib/api/recommendations';
	import type { ActionData, PageData } from './$types';
	import { ICON } from '$lib/icon';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// The accounts the preview can run for, searchable by email. The field still
	// takes a typed id, so an account past the first page is reachable.
	const readerOptions = $derived(
		(data.readers ?? []).map((r) => ({ value: r.id, label: r.email, keywords: [r.id] }))
	);

	const formError = $derived((form as { error?: string } | null)?.error ?? '');
	const outcome = $derived(
		form as { refreshed?: boolean; pairs?: number; trending?: number; feeds?: number; ms?: number } | null,
	);
	const preview = $derived(
		(form as { previewFor?: string; feed?: FeedEntry[] } | null)?.feed ?? null,
	);
	const previewFor = $derived((form as { previewFor?: string } | null)?.previewFor ?? '');

	const stats = $derived(data.stats);
	const skewed = $derived(splitIsSkewed(stats));

	let userId = $state('');
	let recomputing = $state(false);

	// The recompute rebuilds everything and takes minutes on a large corpus,
	// so the button has to stay busy for the whole of it rather than look idle
	// and invite a second press.
	const recompute: SubmitFunction = () => {
		recomputing = true;
		return async ({ update }) => {
			await update();
			recomputing = false;
		};
	};
</script>

<PageTitle title="Recommendations" />

<PageShell
	title="Recommendations"
	description="Similar entries, trending entries and a feed per reader, computed from what your readers do."
	width="wide"
	back={{ href: '/admin/settings', label: 'Settings' }}
>
	{#snippet actions()}
		{#if data.gate.state === 'ok' && data.canRecompute}
			<form method="POST" action="?/refresh" use:enhance={recompute}>
				<Button variant="secondary" size="sm" type="submit" loading={recomputing}>
					<RefreshCw size={ICON.sm} /> Recompute
				</Button>
			</form>
		{/if}
	{/snippet}

	{#if data.gate.state !== 'ok'}
		<GateNotice
			gate={data.gate}
			title="Recommendations"
			absent="The recommendations plugin is not part of this build, so nothing is being computed."
		/>
	{:else}
		{#if formError}
			<!-- A recompute already under way is its own outcome, not a fault,
			     so it is shown as information rather than in red. -->
			<Alert tone={formError.includes('already running') ? 'warn' : 'danger'}>{formError}</Alert>
		{/if}

		{#if outcome?.refreshed}
			<Alert tone="success" autoDismiss>
				Recomputed in {took(outcome.ms)}: {outcome.pairs} similarity pairs, {outcome.trending}
				trending items and {outcome.feeds} feeds.
			</Alert>
		{/if}

		<Card>
			<div class="flex flex-col gap-3 text-sm text-muted">
				<SectionHeading level={3}>What recommendations do</SectionHeading>
				<p>
					Your application tells the engine what each reader does: views, likes, bookmarks and shares,
					weighted 1, 2, 5 and 3. From that the plugin works out three lists: entries similar to one
					another (read by the same people over the last 30 days), what is trending this week, and a
					feed per reader built from what people like them read. Readers are split between the
					recommended feed and a random baseline, so the split below shows whether recommending changes
					what people read.
				</p>
				<p>
					The lists are computed, not live: new behavior counts once a super admin recomputes them.
					Nothing recomputes on a schedule yet, so
					run it after a batch of activity, or from a cron job calling
					<span class="font-mono text-xs">POST /api/admin/recommendations/refresh</span>.
				</p>
			</div>
		</Card>

		<section class="flex flex-col gap-4">
			<SectionHeading level={2}>Trending now</SectionHeading>
			{#if !data.trending}
				<Alert tone="warn">The trending list could not be read.</Alert>
			{:else if data.trending.length === 0}
				<EmptyState
					title="Nothing is trending yet"
					description="An entry trends once readers have been tracked on it and a recompute has run."
				/>
			{:else}
				<Table label="Trending now">
					<thead>
						<tr>
							<th scope="col">Entry</th>
							<th scope="col">Score</th>
							<th scope="col">Views</th>
						</tr>
					</thead>
					<tbody>
						{#each data.trending as item (item.content_id)}
							<tr>
								<td>
									<span class="text-sm text-fg">{item.title || item.slug || item.content_id}</span>
									{#if item.slug}<span class="block font-mono text-xs text-faint">{item.slug}</span>{/if}
								</td>
								<td data-cell="nowrap" class="font-mono text-xs">{item.score.toFixed(1)}</td>
								<td data-cell="nowrap" class="font-mono text-xs">{item.view_count}</td>
							</tr>
						{/each}
					</tbody>
				</Table>
			{/if}
		</section>

		<section class="flex flex-col gap-4">
			<SectionHeading level={2}>Wire it into your application</SectionHeading>
			<p class="text-sm text-muted">
				Every call takes the reader's token or an API key, and reads the tenant from it.
			</p>
			<div class="flex flex-col gap-2">
				<div class="flex justify-end"><CopyButton value={INTEGRATION_EXAMPLE} label="Copy the calls" /></div>
				<pre class="overflow-auto rounded border border-line bg-surface-2 p-3 font-mono text-xs">{INTEGRATION_EXAMPLE}</pre>
			</div>
		</section>

		<section class="flex flex-col gap-4">
			<SectionHeading level={2}>The split</SectionHeading>
			{#if !hasUsers(stats)}
				<!-- Nobody has been bucketed yet, which on a fresh install is
				     correct. Drawing it as an even split of zero people would read
				     as a working experiment. -->
				<EmptyState
					title="Nobody has been bucketed yet"
					description="No reader has asked for a feed, so there is no split to report."
				>
					{#snippet iconSnippet()}
						<Sparkles size={ICON.lg} />
					{/snippet}
				</EmptyState>
			{:else if stats}
				<div class="grid gap-4 sm:grid-cols-3">
					<Stat size="sm" mono label="Readers bucketed" value={stats.total_users} />
					<Stat size="sm" mono label="Getting recommendations" value={percent(stats.recommendation_pct)} />
					<Stat size="sm" mono label="Control arm, random" value={percent(stats.random_pct)} />
				</div>
				<p class="text-xs text-muted">
					{stats.recommendation_count} readers see computed recommendations and
					{stats.random_count} see random picks, which is what the computed ones are measured
					against.
				</p>
				<!-- The banner sits under the tiles rather than between them, so the
				     row of three numbers stays whole. -->
				{#if skewed}
					<Alert tone="warn">
						The two arms are far apart. Bucketing is by hash, so a few points of drift is
						normal and this is not: either the control arm is too small to measure against,
						or a real share of readers are being shown random content.
					</Alert>
				{/if}
			{/if}
		</section>

		<section class="flex flex-col gap-4">
			<SectionHeading level={2}>What one reader would see</SectionHeading>
			{#if !data.canRecompute}
				<Alert tone="brand">
					Generating a feed for a named reader is a super admin's, since it reads what that
					person has been doing.
				</Alert>
			{:else}
				<p class="text-xs text-muted">
					Generates the feed for one reader now. This is the same computation the reader would
					get, so it shows what they would actually be shown rather than a sample.
					{#if readerOptions.length > 0}
						Search by email, or paste an id for an account past the first page.
					{:else}
						Give the user id as it appears on the Users page.
					{/if}
				</p>
				<!-- A field and its button, at the width the field needs. The
				     guidance sits in the paragraph above rather than under the
				     field, because a hint there would make the field taller than
				     the button and align the button with the hint instead of the
				     input. -->
				<form method="POST" action="?/preview" use:enhance class="flex flex-wrap items-end gap-2">
					<div class="w-full min-w-0 sm:w-80">
						{#if readerOptions.length > 0}
							<Autocomplete
								id="rec-user"
								name="user_id"
								label="Reader"
								options={readerOptions}
								bind:value={userId}
							/>
						{:else}
							<Input
								id="rec-user"
								name="user_id"
								label="Reader"
								bind:value={userId}
							/>
						{/if}
					</div>
					<Button variant="secondary" type="submit">
						<UserSearch size={ICON.sm} /> Generate
					</Button>
				</form>

				{#if preview !== null}
					{#if preview.length === 0}
						<EmptyState
							title="Nothing to recommend to this reader"
							description="Either they have read nothing yet, or no content is similar enough to rank."
						>
							{#snippet iconSnippet()}
								<Sparkles size={ICON.lg} />
							{/snippet}
						</EmptyState>
					{:else}
						<p class="text-xs text-muted">
							{preview.length} entries for {previewFor}.
						</p>
						<Table label="What one reader would see">
							<thead>
								<tr>
									<th scope="col">Content</th>
									<th scope="col">Why</th>
									<th scope="col">Score</th>
								</tr>
							</thead>
							<tbody>
								{#each preview as entry (entry.id)}
									<tr>
										<td data-cell="nowrap" class="font-mono text-xs">{entry.content_id}</td>
										<td data-cell="nowrap">
											<!-- A random pick is the control arm, not a broken
											     recommendation, so it is marked apart. -->
											<Badge tone={sourceTone(entry.source)}>{sourceLabel(entry.source)}</Badge>
										</td>
										<td data-cell="nowrap" class="font-mono text-xs">{score(entry.score)}</td>
									</tr>
								{/each}
							</tbody>
						</Table>
					{/if}
				{/if}
			{/if}
		</section>
	{/if}
</PageShell>
