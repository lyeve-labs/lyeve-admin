<script lang="ts">
	import PageTitle from '$lib/components/PageTitle.svelte';
	import {
		Alert,
		Badge,
		Button,
		Drawer,
		EmptyState,
		Input,
		PageShell,
		SectionHeading,
		Stat,
		Table,
		Toggle,
		confirm as confirmDialog,
		toast,
		Pagination,
	} from '@lyeve-labs/ui-kit';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import RefusalNotice from '$lib/components/RefusalNotice.svelte';
	import { formRefusal } from '$lib/api/refusal';
	import { enhance } from '$app/forms';
	import { tracked } from '$lib/forms.svelte';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { Database, Eraser, Pencil, Plus, RotateCcw, Route, Trash2 } from '@lucide/svelte';
	import {
		CIRCUIT_LABELS,
		atCeiling,
		inactiveReason,
		ruleCount,
		ttlLabel,
		type CacheRule,
		bytes,
		circuitState,
		circuitTone,
		fullness,
		hitRate,
		tagsOf,
		trippedProviders,
		underPressure,
		type CacheProvider,
	} from '$lib/api/cache';
	import { formatDateTime } from '$lib/format';
	import type { ActionData, PageData } from './$types';
	import { pageHref, pageNumber } from '$lib/api/list';
	import { ICON } from '$lib/icon';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const formError = $derived((form as { error?: string } | null)?.error ?? '');
	const rate = $derived(hitRate(data.stats));
	const full = $derived(fullness(data.stats));
	const tripped = $derived(trippedProviders(data.providers));
	const tags = $derived(tagsOf(data.entries));
	const refusal = $derived(formRefusal(form));
	const rules = $derived(data.rules);
	const ruleTags = $derived([...new Set(rules.rows.flatMap((r) => r.tags))].sort());
	const rulesFull = $derived(rules.licensed !== true && atCeiling(rules.limit));

	let ruleOpen = $state(false);
	let editing = $state<CacheRule | null>(null);
	let pattern = $state('/api/v1/content/{schema}');
	let ttl = $state('300');
	let ruleTagText = $state('');
	let ruleEnabled = $state(true);
	let purgeTag = $state('');

	function openCreate() {
		editing = null;
		pattern = '/api/v1/content/{schema}';
		ttl = '300';
		ruleTagText = '';
		ruleEnabled = true;
		ruleOpen = true;
	}

	function openEdit(r: CacheRule) {
		editing = r;
		pattern = r.pattern;
		ttl = String(r.ttl_seconds);
		ruleTagText = r.tags.join(', ');
		ruleEnabled = r.enabled;
		ruleOpen = true;
	}

	const saveRule = tracked(() => {
		const verb = editing ? 'Saved' : 'Created';
		const subject = pattern;
		return async ({ result, update }) => {
			if (result.type !== 'failure') ruleOpen = false;
			await update();
			if (result.type === 'success') toast.success(`${verb} ${subject}`);
		};
	});

	function removeRule(r: CacheRule): SubmitFunction {
		return async ({ cancel }) => {
			const confirmed = await confirmDialog(
				`Delete the rule for ${r.pattern}?`,
				'What it cached is evicted with it, and the route is served uncached from the next request.',
				{ confirmLabel: 'Delete' },
			);
			if (!confirmed) {
				cancel();
				return;
			}
			return async ({ result, update }) => {
				await update();
				if (result.type === 'success') toast.success(`Deleted the rule for ${r.pattern}`);
			};
		};
	}

	/**
	 * A purge evicts this tenant's cached responses. Every one is recomputed on
	 * its next request, so the confirm says what it puts on the database.
	 */
	function purge(what: string): SubmitFunction {
		return async ({ cancel }) => {
			const confirmed = await confirmDialog(
				`Purge ${what}?`,
				'Each purged response is computed again the next time it is asked for.',
				{ confirmLabel: 'Purge' },
			);
			if (!confirmed) {
				cancel();
				return;
			}
			return async ({ result, update }) => {
				await update();
				if (result.type === 'success') {
					const n = (result.data as { purged?: number } | undefined)?.purged ?? 0;
					toast.success(`Purged ${n} ${n === 1 ? 'response' : 'responses'}`);
				}
			};
		};
	}

	/**
	 * Every flushed key is recomputed on its next request, so this is a
	 * deliberate load against the database rather than a tidy-up.
	 */
	function flush(tag: string): SubmitFunction {
		return async ({ cancel }) => {
			const what = tag ? `everything tagged ${tag}` : 'the whole cache';
			const confirmed = await confirmDialog(
				`Flush ${what}?`,
				'Every flushed key is recomputed the next time it is asked for, so this puts that load on the database at once.',
				{ confirmLabel: 'Flush' },
			);
			if (!confirmed) {
				cancel();
				return;
			}
			return async ({ result, update }) => {
				await update();
				if (result.type === 'success') toast.success(`Flushed ${what}`);
			};
		};
	}

	function reset(p: CacheProvider): SubmitFunction {
		return () =>
			async ({ result, update }) => {
				await update();
				if (result.type === 'success') toast.success(`Reset the circuit for ${p.name}`);
			};
	}
</script>

<PageTitle title="Cache" />

<PageShell
	title="Cache"
	description="What is being served from cache, which backends are behind it, and what is stored."
	width="wide"
	back={{ href: '/admin/observability', label: 'Observability' }}
>
	{#snippet actions()}
		{#if data.gate.state === 'ok' && rules.gate.state === 'ok'}
			<Button variant="primary" size="sm" onclick={openCreate}>
				<Plus size={ICON.sm} /> New rule
			</Button>
		{/if}
	{/snippet}

	{#if data.gate.state !== 'ok'}
		<GateNotice
			gate={data.gate}
			title="Cache"
			absent="The cache plugin is not part of this build, so nothing is cached."
		/>
	{:else}
		{#if refusal}
			<RefusalNotice {refusal} />
		{:else if formError}
			<Alert tone="danger">{formError}</Alert>
		{/if}

		{#if tripped.length > 0}
			<!-- The reading the stats hide. A lower-priority provider picks up
			     when one trips, so the hit rate stays plausible while a backend
			     is entirely out of service. -->
			<Alert tone="danger">
				{tripped.length}
				{tripped.length === 1 ? 'provider is' : 'providers are'} cut out by their circuit
				breaker. The hit rate above still looks reasonable because another provider is
				picking up, so nothing else reports this.
			</Alert>
		{/if}

		{#if data.stats}
			<div class="grid gap-4 sm:grid-cols-4">
				<Stat
					size="sm"
					mono
					label="Hit rate"
					value={rate === null ? 'Nothing asked yet' : `${rate}%`}
				/>
				<Stat size="sm" mono label="Entries" value={data.stats.entries} />
				<Stat
					size="sm"
					mono
					label="Evicted"
					value={data.stats.evictions}
					tone={underPressure(data.stats) ? 'warn' : 'neutral'}
				/>
				<Stat size="sm" mono label="Misses" value={data.stats.misses} />
			</div>

			{#if underPressure(data.stats)}
				<!-- Evictions mean entries left before their TTL because the
				     store was full. A capacity problem dressed as a working
				     cache: the hit rate falls and nothing errors. -->
				<Alert tone="warn">
					{data.stats.evictions} entries were pushed out before they expired, which means the
					store filled up. The hit rate falls and nothing errors, so this is the only place
					it shows.
					{#if full !== null}
						The store is {Math.round(full * 100)}% of its ceiling.
					{/if}
				</Alert>
			{/if}
		{/if}

		<section class="flex flex-col gap-4">
			<SectionHeading level={2}>Providers</SectionHeading>
			{#if data.providersRead && data.providersLicensed !== null}
				<p class="text-sm text-muted" data-testid="provider-tier">
					{#if data.providersLicensed}
						Every configured provider runs, in priority order, with failover and a circuit breaker on each.
					{:else}
						This install runs one provider, the highest-priority one that starts. Any other configured
						provider is listed below as left out.
					{/if}
				</p>
			{/if}
			{#if !data.providersRead}
				<Alert tone="danger">
					The providers could not be read. This is not a report that all of them are healthy.
				</Alert>
			{:else if data.providers.length === 0}
				<EmptyState
					title="No provider is configured"
					description="The plugin is running with nowhere to store anything."
				>
					{#snippet iconSnippet()}
						<Database size={ICON.lg} />
					{/snippet}
				</EmptyState>
			{:else}
				<Table label="Providers">
					<thead>
						<tr>
							<th scope="col">Provider</th>
							<th scope="col">Circuit</th>
							<th scope="col">Priority</th>
							<th scope="col"><span class="sr-only">Actions</span></th>
						</tr>
					</thead>
					<tbody>
						{#each data.providers as p (p.name)}
							<tr>
								<td data-cell="nowrap">
									<span class="font-medium text-fg">{p.name}</span>
									<div class="text-xs text-faint">{p.kind}</div>
								</td>
								<td data-cell="nowrap">
									<Badge tone={circuitTone(circuitState(p))} dot>
										{CIRCUIT_LABELS[circuitState(p)]}
									</Badge>
								</td>
								<td data-cell="nowrap" class="font-mono text-xs">{p.priority}</td>
								<td data-cell="nowrap">
									<div class="flex justify-end">
										{#if data.superAdmin && circuitState(p) === 'open'}
											<form method="POST" action="?/resetCircuit" use:enhance={reset(p)}>
												<input type="hidden" name="name" value={p.name} />
												<Button
													variant="ghost"
													size="sm"
													type="submit"
													aria-label="Reset the circuit for {p.name}"
													title="Try this provider again"
												>
													<RotateCcw size={ICON.sm} />
												</Button>
											</form>
										{/if}
									</div>
								</td>
							</tr>
						{/each}
					</tbody>
				</Table>
			{/if}
			{#if data.inactive.length > 0}
				<Table label="Configured providers that are not running">
					<thead>
						<tr>
							<th scope="col">Not running</th>
							<th scope="col">Priority</th>
							<th scope="col">Why</th>
						</tr>
					</thead>
					<tbody>
						{#each data.inactive as p (p.name)}
							<tr>
								<td data-cell="nowrap">
									<span class="font-medium text-fg">{p.name}</span>
									<div class="text-xs text-faint">{p.kind}</div>
								</td>
								<td data-cell="nowrap" class="font-mono text-xs">{p.priority}</td>
								<td class="text-xs text-muted">{inactiveReason(p.reason)}</td>
							</tr>
						{/each}
					</tbody>
				</Table>
			{/if}
		</section>

		<section class="flex flex-col gap-4" aria-label="Response cache rules">
			<div class="flex flex-wrap items-center gap-2">
				<SectionHeading level={2}>Response cache rules</SectionHeading>
				{#if rules.gate.state === 'ok'}
					<Badge tone={rulesFull ? 'warn' : 'neutral'}>{ruleCount(rules.limit, rules.rows.length)}</Badge>
				{/if}
			</div>
			<p class="text-sm text-muted">
				A rule serves a public read route of this tenant from the cache for its time to live. A content
				change purges what the rules tagged with its content type, and a rule with no tags is purged by
				every content change.
			</p>
			{#if rules.gate.state !== 'ok'}
				<GateNotice
					gate={rules.gate}
					title="Response cache rules"
					absent="This version of the cache plugin keeps no response cache rules."
				/>
			{:else}
				{#if rulesFull}
					<Alert tone="warn" title="Every rule this install allows is in use">
						{rules.limit?.current} of {rules.limit?.limit} rules are in use. Delete one to add another, or
						change the license to allow more. Existing rules keep serving either way.
					</Alert>
				{/if}

				<div class="flex flex-wrap items-end gap-2">
					<form method="POST" action="?/purge" use:enhance={purge('every cached response of this tenant')}>
						<Button variant="secondary" size="sm" type="submit">
							<Eraser size={ICON.sm} /> Purge all
						</Button>
					</form>
					<form
						method="POST"
						action="?/purge"
						class="flex items-end gap-2"
						use:enhance={purge(`the responses tagged ${purgeTag || 'with this tag'}`)}
					>
						<Input id="purge-tag" name="tag" label="Purge by tag" placeholder="posts" bind:value={purgeTag} />
						<Button variant="secondary" size="sm" type="submit" disabled={!purgeTag.trim()}>Purge tag</Button>
					</form>
					{#if ruleTags.length > 0}
						<p class="text-xs text-faint">Tags in use: {ruleTags.join(', ')}</p>
					{/if}
				</div>

				{#if rules.rows.length === 0}
					<EmptyState
						title="No response is cached by rule"
						description="Every public read is computed on each request until a rule names its route."
					>
						{#snippet iconSnippet()}
							<Route size={ICON.lg} />
						{/snippet}
						{#snippet action()}
							<Button variant="secondary" onclick={openCreate}>
								<Plus size={ICON.sm} /> New rule
							</Button>
						{/snippet}
					</EmptyState>
				{:else}
					<Table label="Response cache rules">
						<thead>
							<tr>
								<th scope="col">Route</th>
								<th scope="col">Time to live</th>
								<th scope="col">Tags</th>
								<th scope="col">State</th>
								<th scope="col"><span class="sr-only">Actions</span></th>
							</tr>
						</thead>
						<tbody>
							{#each rules.rows as r (r.id)}
								<tr>
									<td class="max-w-md truncate font-mono text-xs" title={r.pattern}>{r.pattern}</td>
									<td data-cell="nowrap" class="font-mono text-xs">{ttlLabel(r.ttl_seconds)}</td>
									<td class="text-xs text-faint">{r.tags.join(', ') || 'Every content change'}</td>
									<td data-cell="nowrap">
										<Badge tone={r.enabled ? 'success' : 'neutral'} dot>{r.enabled ? 'Serving' : 'Off'}</Badge>
									</td>
									<td data-cell="nowrap">
										<div class="flex items-center justify-end gap-1">
											<form method="POST" action="?/purge" use:enhance={purge(`what ${r.pattern} cached`)}>
												<input type="hidden" name="rule" value={r.id} />
												<Button variant="ghost" size="sm" type="submit" aria-label="Purge {r.pattern}" title="Purge">
													<Eraser size={ICON.sm} />
												</Button>
											</form>
											<Button variant="ghost" size="sm" aria-label="Edit {r.pattern}" onclick={() => openEdit(r)}>
												<Pencil size={ICON.sm} />
											</Button>
											<form method="POST" action="?/deleteRule" use:enhance={removeRule(r)}>
												<input type="hidden" name="id" value={r.id} />
												<Button variant="ghost" size="sm" type="submit" aria-label="Delete {r.pattern}">
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
			{/if}
		</section>

		{#if data.superAdmin}
		<section class="flex flex-col gap-4">
			<SectionHeading level={2}>Stored</SectionHeading>
			<div class="flex flex-wrap items-center gap-2">
				<form method="POST" action="?/flush" use:enhance={flush('')}>
					<Button variant="secondary" size="sm" type="submit">
						<Trash2 size={ICON.sm} /> Flush everything
					</Button>
				</form>
				{#each tags as tag (tag)}
					<form method="POST" action="?/flush" use:enhance={flush(tag)}>
						<input type="hidden" name="tag" value={tag} />
						<Button variant="ghost" size="sm" type="submit">Flush {tag}</Button>
					</form>
				{/each}
			</div>

			{#if data.entries.length === 0}
				<EmptyState
					title="Nothing is cached"
					description="Either nothing has been asked for yet, or every entry has expired."
				>
					{#snippet iconSnippet()}
						<Database size={ICON.lg} />
					{/snippet}
				</EmptyState>
			{:else}
				<Table label="Stored">
					<thead>
						<tr>
							<th scope="col">Key</th>
							<th scope="col">Size</th>
							<th scope="col">Tags</th>
							<th scope="col">Expires</th>
						</tr>
					</thead>
					<tbody>
						{#each data.entries as e (e.key)}
							<tr>
								<td class="max-w-md truncate font-mono text-xs" title={e.key}>{e.key}</td>
								<td data-cell="nowrap" class="font-mono text-xs">{bytes(e.size)}</td>
								<td data-cell="nowrap" class="text-xs text-faint">
									{(e.tags ?? []).join(', ') || '-'}
								</td>
								<td data-cell="nowrap" class="text-xs text-faint">
									{formatDateTime(e.expires_at)}
								</td>
							</tr>
						{/each}
					</tbody>
				</Table>
				<Pagination
					page={pageNumber(data.offset, data.limit)}
					perPage={data.limit}
					count={data.entries.length}
					total={data.total ?? undefined}
					hasNext={data.hasMore}
					noun="entries"
					href={pageHref('/admin/observability/cache', data.limit)}
				/>
			{/if}
		</section>
		{/if}
	{/if}
</PageShell>

<Drawer bind:open={ruleOpen} title={editing ? 'Edit rule' : 'New rule'}>
	{#if refusal}
		<div class="mb-4"><RefusalNotice {refusal} /></div>
	{:else if formError}
		<div class="mb-4"><Alert tone="danger">{formError}</Alert></div>
	{/if}
	<form id="cache-rule-form" method="POST" action={editing ? '?/updateRule' : '?/createRule'} use:enhance={saveRule.enhance}>
		{#if editing}
			<input type="hidden" name="id" value={editing.id} />
		{/if}
		<div class="flex flex-col gap-4">
			<Input
				id="rule-pattern"
				name="pattern"
				label="Route"
				hint="A path under /api/v1/. A segment may be a glob such as post-*, a {'{name}'} for any one segment, and ** may end it."
				bind:value={pattern}
				required
			/>
			<Input
				id="rule-ttl"
				name="ttl_seconds"
				label="Time to live, in seconds"
				hint="How long a cached response is served before it is computed again."
				bind:value={ttl}
				required
			/>
			<Input
				id="rule-tags"
				name="tags"
				label="Tags"
				hint="The content types whose changes purge this rule, separated by commas. Empty means every content change."
				bind:value={ruleTagText}
			/>
			<input type="hidden" name="enabled" value={ruleEnabled ? 'true' : 'false'} />
			<Toggle id="rule-enabled" label="Serve from the cache" bind:checked={ruleEnabled} />
		</div>
	</form>
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (ruleOpen = false)}>Cancel</Button>
		<Button variant="primary" type="submit" form="cache-rule-form" loading={saveRule.pending}>
			{editing ? 'Save' : 'Create'}
		</Button>
	{/snippet}
</Drawer>
