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
		SearchInput,
		SectionHeading,
		Stat,
		Table,
		Textarea,
		Toggle,
		confirm,
	} from '@lyeve-labs/ui-kit';
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { Copy, Eye, Pencil, Plus, RefreshCw, Search, ShieldCheck, Trash2 } from '@lucide/svelte';
	import { duplicateRow } from '$lib/duplicate';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import ListToolbar from '$lib/components/ListToolbar.svelte';
	import {
		byType,
		inApplyOrder,
		overriddenPresets,
		shortPattern,
		type CustomRule,
	} from '$lib/api/pii-mask';
	import { NO_VALUE, formatDateTime } from '$lib/format';
	import type { ActionData, PageData } from './$types';
	import { ICON } from '$lib/icon';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let refreshing = $state(false);
	async function refresh() {
		refreshing = true;
		try {
			await invalidateAll();
		} finally {
			refreshing = false;
		}
	}

	let narrow = $state('');

	const rules = $derived(inApplyOrder(data.rules?.presets ?? []));
	const custom = $derived(data.rules?.custom ?? []);
	const overridden = $derived(overriddenPresets(custom));
	const enabledCount = $derived(custom.filter((r) => r.enabled).length);
	const maxEnabled = $derived(data.rules?.limits?.max_enabled_rules ?? 50);
	const tags = $derived(Object.entries(data.rules?.mask_tags ?? {}));

	// The rule being written. A new one starts disabled: a pattern saved
	// straight into the masking path is a change to every response, and it is
	// the one thing an operator cannot undo by reading the page.
	const BLANK = {
		id: '',
		name: '',
		description: '',
		pattern: '',
		replacement: '[redacted]',
		priority: 100,
		enabled: false,
	};
	let editing = $state({ ...BLANK });
	let open = $state(false);
	let sample = $state('');

	const testResult = $derived((form as { test?: unknown } | null)?.test ?? null);
	const formError = $derived((form as { error?: string } | null)?.error ?? '');

	function newRule() {
		editing = { ...BLANK };
		sample = '';
		open = true;
	}

	function edit(rule: CustomRule) {
		editing = {
			id: rule.id,
			name: rule.name,
			description: rule.description ?? '',
			pattern: rule.pattern,
			replacement: rule.replacement,
			priority: rule.priority,
			enabled: rule.enabled,
		};
		sample = '';
		open = true;
	}

	// The number input binds a string, and an empty box must not read as zero:
	// zero would run the rule ahead of every preset, which is the opposite of
	// what leaving a field blank means. The server applies the same default.
	let priorityText = $state('100');
	$effect(() => {
		priorityText = String(editing.priority ?? 100);
	});

	/**
	 * Copy a rule into the create drawer.
	 *
	 * The copy arrives switched off, which matters more here than anywhere
	 * else: a redaction rule that starts masking the moment it saves changes
	 * every response, and the operator pressed Duplicate because they are
	 * about to change the pattern.
	 */
	function duplicate(rule: CustomRule) {
		const draft = duplicateRow(rule as unknown as Record<string, unknown>, {
			taken: custom.map((r) => r.name),
		});
		editing = {
			id: '',
			name: String(draft.name ?? rule.name),
			description: rule.description ?? '',
			pattern: rule.pattern,
			replacement: rule.replacement,
			priority: rule.priority,
			enabled: false,
		};
		sample = '';
		open = true;
	}

	let deleteForm = $state<HTMLFormElement>();
	let deleteId = $state('');

	async function askDelete(rule: CustomRule) {
		deleteId = rule.id;
		const ok = await confirm(
			'Delete rule',
			`Delete ${rule.name}? Anything it was hiding is served unmasked from the next request.`,
			{ confirmLabel: 'Delete' },
		).catch(() => false);
		if (ok) deleteForm?.requestSubmit();
	}
	const looks = $derived(byType(data.entries));
	const visible = $derived(
		narrow.trim()
			? data.entries.filter((e) =>
					`${e.pii_type} ${e.record_type ?? ''} ${e.viewer_role ?? ''}`
						.toLowerCase()
						.includes(narrow.trim().toLowerCase()),
				)
			: data.entries,
	);
</script>

<PageTitle title="PII masking" />

<PageShell
	title="PII masking"
	description="What is redacted from responses and logs, and who has read it unmasked."
	width="wide"
	back={{ href: '/admin/settings', label: 'Settings' }}
>
	{#snippet actions()}
		<Button variant="secondary" size="sm" onclick={refresh} loading={refreshing}>
			<RefreshCw size={ICON.sm} /> Refresh
		</Button>
		<!-- Optional, because a page can be rendered before its load has run and
		     a header that dereferences the gate takes the whole page down. -->
		{#if data.gate?.state === 'ok'}
			<Button variant="primary" size="sm" onclick={newRule}>
				<Plus size={ICON.sm} /> New rule
			</Button>
		{/if}
	{/snippet}

	{#if data.gate.state !== 'ok'}
		<GateNotice
			gate={data.gate}
			title="PII masking"
			absent="The masking plugin is not part of this build, so responses are served as they are stored."
		/>
	{:else}
		{#if formError}
			<Alert tone="danger">{formError}</Alert>
		{/if}
		{#if form && 'saved' in form && form.saved}
			<Alert tone="success" autoDismiss>Saved. It applies from the next request.</Alert>
		{/if}
		{#if form && 'deleted' in form && form.deleted}
			<Alert tone="success" autoDismiss>Deleted.</Alert>
		{/if}

		<div class="grid gap-4 sm:grid-cols-4">
			<!-- What is running, which is the presets this tenant has not
			     replaced plus its own enabled rules. The presets alone are not
			     what masks a value. -->
			<Stat
				size="sm"
				mono
				label="Rules applied"
				value={rules.filter((r) => !overridden.has(r.name.toUpperCase())).length + enabledCount}
			/>
			<Stat size="sm" mono label="Your own rules" value={`${enabledCount} of ${maxEnabled}`} />
			<Stat size="sm" mono label="Mask styles" value={tags.length} />
			<Stat size="sm" mono label="Unmasked reads" value={data.total} />
		</div>

		<section class="flex flex-col gap-4">
			<SectionHeading level={2}>Your own rules</SectionHeading>
			<p class="text-xs text-muted">
				Patterns this tenant adds, in RE2, which is the syntax Go's regular expressions use. RE2
				does not backtrack, so a pattern here cannot be made to run away with a response, and it
				has no backreferences and no lookahead. A rule named after a preset takes that preset's
				place, which is how one is narrowed or turned off. Every enabled rule is another pass
				over every response body, so twenty of them roughly halve how fast masking runs.
			</p>

			{#if custom.length === 0}
				<EmptyState
					title="No rules of your own"
					description="The presets below are masking. Add a pattern for the identifiers only you use, such as an account or order number."
				>
					{#snippet iconSnippet()}
						<ShieldCheck size={ICON.lg} />
					{/snippet}
				</EmptyState>
			{:else}
				<Table label="Your own rules">
					<thead>
						<tr>
							<th scope="col">Order</th>
							<th scope="col">Rule</th>
							<th scope="col">Matches</th>
							<th scope="col">Replaced with</th>
							<th scope="col">State</th>
							<th scope="col" class="text-right">Actions</th>
						</tr>
					</thead>
					<tbody>
						{#each custom as rule (rule.id)}
							<tr>
								<td data-cell="nowrap" class="text-xs text-faint">{rule.priority}</td>
								<td data-cell="nowrap">
									{rule.name}
									{#if rule.description}
										<div class="text-xs text-faint">{rule.description}</div>
									{/if}
								</td>
								<td class="font-mono text-xs" title={rule.pattern}>{shortPattern(rule.pattern)}</td>
								<td data-cell="nowrap" class="font-mono text-xs">{rule.replacement}</td>
								<td data-cell="nowrap">
									{#if rule.enabled}
										<Badge tone="success">Masking</Badge>
									{:else}
										<Badge tone="neutral">Off</Badge>
									{/if}
								</td>
								<td data-cell="nowrap" class="text-right">
									<Button variant="ghost" size="sm" aria-label={`Edit ${rule.name}`} onclick={() => edit(rule)}>
										<Pencil size={ICON.sm} />
									</Button>
									<Button variant="ghost" size="sm" aria-label={`Duplicate ${rule.name}`} onclick={() => duplicate(rule)}>
										<Copy size={ICON.sm} />
									</Button>
									<Button variant="ghost" size="sm" aria-label={`Delete ${rule.name}`} onclick={() => askDelete(rule)}>
										<Trash2 size={ICON.sm} class="text-danger" />
									</Button>
								</td>
							</tr>
						{/each}
					</tbody>
				</Table>
			{/if}
		</section>

		<!-- One hidden form for the delete, submitted by the confirmation
		     rather than by a button of its own. -->
		<form method="POST" action="?/delete" use:enhance bind:this={deleteForm} class="hidden">
			<input type="hidden" name="id" value={deleteId} />
		</form>

		<section class="flex flex-col gap-4">
			<SectionHeading level={2}>Presets, in the order they run</SectionHeading>
			<p class="text-xs text-muted">
				Priority decides which rule wins where two patterns match the same text, and lower runs
				first. These ship with the plugin and cannot be edited, so a mistake in one of your own
				rules cannot break email masking for everyone. Write a rule with a preset's name to take
				its place.
			</p>

			{#if rules.length === 0}
				<EmptyState
					title="No rule is loaded"
					description="The plugin is running with no pattern, so nothing is being redacted."
				>
					{#snippet iconSnippet()}
						<ShieldCheck size={ICON.lg} />
					{/snippet}
				</EmptyState>
			{:else}
				<Table label="Rules, in the order they run">
					<thead>
						<tr>
							<th scope="col">Order</th>
							<th scope="col">Rule</th>
							<th scope="col">Matches</th>
							<th scope="col">Replaced with</th>
						</tr>
					</thead>
					<tbody>
						{#each rules as rule (rule.name)}
							{@const replaced = overridden.has(rule.name.toUpperCase())}
							<tr class={replaced ? 'opacity-60' : ''}>
								<td data-cell="nowrap" class="text-xs text-faint">{rule.priority}</td>
								<td data-cell="nowrap">
									{rule.name}
									{#if replaced}
										<Badge tone="neutral">replaced by yours</Badge>
									{/if}
									{#if rule.description}
										<div class="text-xs text-faint">{rule.description}</div>
									{/if}
								</td>
								<td class="font-mono text-xs" title={rule.pattern}
									>{shortPattern(rule.pattern)}</td
								>
								<td data-cell="nowrap" class="font-mono text-xs">{rule.replacement}</td>
							</tr>
						{/each}
					</tbody>
				</Table>
			{/if}

			{#if tags.length > 0}
				<div class="flex flex-wrap items-center gap-2">
					<span class="text-xs text-muted">Mask styles a field can ask for</span>
					{#each tags as [tag, meaning] (tag)}
						<Badge tone="neutral">{tag}</Badge>
						<span class="text-xs text-faint">{meaning}</span>
					{/each}
				</div>
			{/if}
		</section>

		<section class="flex flex-col gap-4">
			<SectionHeading level={2}>Unmasked reads</SectionHeading>

			{#if data.logFailed}
				<Alert tone="warn">
					The access log did not answer. The rules above are unaffected and masking is still
					running.
				</Alert>
			{:else if data.entries.length === 0}
				<EmptyState
					title="Nobody has read unmasked data"
					description="A row is written when someone with the right to see it reads a field in the clear."
				>
					{#snippet iconSnippet()}
						<Eye size={ICON.lg} />
					{/snippet}
				</EmptyState>
			{:else}
				{#if looks.length > 0}
					<div class="flex flex-wrap items-center gap-2">
						<span class="text-xs text-muted">Most read on this page</span>
						{#each looks.slice(0, 6) as look (look.type)}
							<Badge tone="neutral">{look.type} {look.looks}</Badge>
						{/each}
					</div>
				{/if}

				<ListToolbar label="Filter unmasked reads">
					{#snippet search()}
						<SearchInput
							id="pii-narrow"
							bind:value={narrow}
							placeholder="Kind, record or role on this page"
						/>
					{/snippet}
				</ListToolbar>

				<Table label="Unmasked reads">
					<thead>
						<tr>
							<th scope="col">Read</th>
							<th scope="col">Kind</th>
							<th scope="col">Record</th>
							<th scope="col">Role</th>
						</tr>
					</thead>
					<tbody>
						{#each visible as entry (entry.id)}
							<tr>
								<td data-cell="nowrap" class="text-xs text-faint"
									>{formatDateTime(entry.accessed_at)}</td
								>
								<td data-cell="nowrap">{entry.pii_type}</td>
								<td data-cell="nowrap" class="font-mono text-xs"
									>{entry.record_type ?? NO_VALUE}</td
								>
								<td data-cell="nowrap" class="text-xs">{entry.viewer_role ?? NO_VALUE}</td>
							</tr>
						{/each}
					</tbody>
				</Table>

				{#if visible.length === 0}
					<EmptyState
						title="Nothing on this page matches"
						description="Clear the filter to see the rest."
					>
						{#snippet iconSnippet()}
							<Search size={ICON.lg} />
						{/snippet}
					</EmptyState>
				{/if}
			{/if}
		</section>
	{/if}
</PageShell>

<!--
	The rule being written, and a place to find out what it does before it runs.

	A redaction rule is invisible when it is right and silent when it is wrong,
	so a pattern saved without trying it is a guess about every future response.
	The sample box runs the pattern server-side through the same validation the
	save uses and stores nothing, which is what makes this safe to press
	repeatedly while a pattern is being worked out.
-->
<Drawer bind:open title={editing.id ? `Edit ${editing.name}` : 'New rule'}>
	<form
		method="POST"
		action={editing.id ? '?/update' : '?/create'}
		use:enhance={() => async ({ update }) => {
			await update({ reset: false });
			open = false;
		}}
		class="flex flex-col gap-4"
	>
		{#if editing.id}
			<input type="hidden" name="id" value={editing.id} />
		{/if}

		<Input
			id="rule-name"
			name="name"
			label="Name"
			required
			hint="What a masked value is reported as in the access log. Use a preset's name to take its place."
			bind:value={editing.name}
		/>
		<Input
			id="rule-description"
			name="description"
			label="Description"
			hint="What it matches, for whoever reads this next."
			bind:value={editing.description}
		/>
		<Input
			id="rule-pattern"
			name="pattern"
			label="Pattern"
			required
			hint="RE2 syntax. No backreferences and no lookahead."
			bind:value={editing.pattern}
		/>
		<Input
			id="rule-replacement"
			name="replacement"
			label="Replaced with"
			required
			bind:value={editing.replacement}
		/>
		<Input
			id="rule-priority"
			name="priority"
			label="Priority"
			type="number"
			hint="Lower runs first. The presets run between 5 and 50, so 100 puts yours after all of them."
			bind:value={priorityText}
		/>
		<!-- The kit's Toggle is a button and serializes nothing, so the value
		     the form submits is a field of its own. -->
		<input type="hidden" name="enabled" value={editing.enabled ? 'true' : 'false'} />
		<Toggle
			id="rule-enabled"
			label="Masking"
			hint="A new rule starts off. Turning it on changes every response from the next request."
			bind:checked={editing.enabled}
		/>

		{#snippet footer()}
			<Button variant="secondary" onclick={() => (open = false)}>Cancel</Button>
			<Button variant="primary" type="submit">{editing.id ? 'Save' : 'Create'}</Button>
		{/snippet}
	</form>

	<div class="mt-6 flex flex-col gap-3 border-t border-line pt-4">
		<SectionHeading level={3}>Try it</SectionHeading>
		<p class="text-xs text-muted">
			Paste something the pattern should hide. Nothing here is stored.
		</p>
		<form method="POST" action="?/test" use:enhance class="flex flex-col gap-3">
			<input type="hidden" name="pattern" value={editing.pattern} />
			<input type="hidden" name="replacement" value={editing.replacement} />
			<Textarea
				id="rule-sample"
				name="sample"
				label="Sample"
				rows={3}
				bind:value={sample}
			/>
			<div>
				<Button variant="secondary" size="sm" type="submit">
					<Search size={ICON.sm} /> Run it
				</Button>
			</div>
		</form>

		{#if testResult}
			{@const result = testResult as
				| { valid: false; error: string }
				| { valid: true; matches: string[]; count: number; masked: string }}
			{#if !result.valid}
				<Alert tone="danger">{result.error}</Alert>
			{:else if result.count === 0}
				<!-- The commonest way a rule is wrong. It saves, it enables, and
				     it hides nothing, and no other screen would ever say so. -->
				<Alert tone="warn">
					The pattern is valid and matched nothing in this sample, so it would redact nothing.
				</Alert>
			{:else}
				<Alert tone="success">
					{result.count}
					{result.count === 1 ? 'match' : 'matches'}.
				</Alert>
				<div class="flex flex-col gap-1">
					<span class="text-xs text-muted">What a reader would get</span>
					<pre
						class="overflow-auto rounded-lg border border-line bg-surface-2 p-3 font-mono text-xs text-fg">{result.masked}</pre>
				</div>
			{/if}
		{/if}
	</div>
</Drawer>
