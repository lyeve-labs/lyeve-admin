<script lang="ts">
	import PageTitle from '$lib/components/PageTitle.svelte';
	import { Alert, Badge, Button, Drawer, EmptyState, Input, PageShell, PasswordInput, Table, Toggle, confirm, Pagination } from '@lyeve-labs/ui-kit';
	import { Pencil, Plus, Trash2, Variable as VariableIcon } from '@lucide/svelte';
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { flowBack } from '$lib/flow/back';
	import { submitter } from '$lib/forms.svelte';
	import type { ActionData, PageData } from './$types';
	import type { Variable } from '$lib/api/flows';
	import NotEnabled from '$lib/components/NotEnabled.svelte';
	import { relativeTime, formatDateTime } from '$lib/format';
	import { pageHref, pageNumber } from '$lib/api/list';
	import { ICON } from '$lib/icon';
	

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// The shell shows why the page is unavailable while the flow plugin does
	// not run. A plugin that runs and refuses its routes is said here.
	const enabled = $derived(!data.locked);

	// One drawer for both writes: a null target is a new variable. The value
	// lives here and not in the control: flipping Secret swaps the Input for a
	// PasswordInput, which remounts, and a value held only by the control went
	// with it.
	let open = $state(false);
	let editing = $state<Variable | null>(null);
	let key = $state('');
	let value = $state('');
	let secret = $state(false);

	function openCreate() {
		editing = null;
		key = '';
		value = '';
		secret = false;
		open = true;
	}

	function openEdit(v: Variable) {
		editing = v;
		key = v.key;
		value = v.is_secret ? '' : (v.value ?? '');
		secret = v.is_secret;
		open = true;
	}

	// The drawer closes once the action answers. A failure keeps it open
	// beside the message.
	$effect(() => {
		if (form && 'saved' in form && form.saved) open = false;
	});

	let deleteKey = $state('');
	let deleteForm = $state<HTMLFormElement>();

	async function askDelete(v: Variable) {
		const ok = await confirm('Delete variable', `Delete vars.${v.key}? Expressions that read it will fail.`, { confirmLabel: 'Delete' });
		if (!ok) return;
		deleteKey = v.key;
		await Promise.resolve();
		deleteForm?.requestSubmit();
	}

	const save = submitter(() => (open = false));
</script>

<PageTitle title="Variables - Flows" />

{#if enabled}
	<PageShell
		title="Variables"
		description="Per-tenant values every flow can read as vars.<key>. A secret is stored encrypted, never shown again, and never written to a run record."
		width="wide"
		back={flowBack(page.url)}
	>
		{#snippet actions()}
			<Button variant="primary" size="sm" onclick={openCreate}>
				<Plus size={ICON.sm} />
				New variable
			</Button>
		{/snippet}

		{#if data.loadError}
			<Alert tone="danger" title="Variables could not be loaded">
				{#snippet children()}{data.loadError} Reload once the engine answers again.{/snippet}
			</Alert>
		{/if}

		{#if form && 'error' in form && form.error && !open}
			<Alert tone="danger">
				{#snippet children()}{form.error}{/snippet}
			</Alert>
		{/if}

		{#if data.loadError}
			<!-- Nothing: the empty state would say there are none. -->
		{:else if data.variables.length === 0}
			<EmptyState title="No variables yet" description="Expressions read one as vars.<key>.">
				{#snippet iconSnippet()}<VariableIcon size={ICON.lg} />{/snippet}
				{#snippet action()}
					<Button variant="secondary" onclick={openCreate}>
						<Plus size={ICON.sm} />
						New variable
					</Button>
				{/snippet}
			</EmptyState>
		{:else}
			<Table label="Variables">
				<thead>
					<tr>
						<th scope="col">Key</th>
						<th scope="col">Value</th>
						<th scope="col">Updated</th>
						<th scope="col">Actions</th>
					</tr>
				</thead>
				<tbody>
					{#each data.variables as v (v.key)}
						<tr>
							<td data-cell="nowrap" class="font-mono text-sm text-fg">vars.{v.key}</td>
							<td>
								{#if v.is_secret}
									<span class="flex items-center gap-2">
										<span class="font-mono text-xs text-faint" aria-label="Secret value hidden">********</span>
										<Badge tone="brand" size="sm">secret</Badge>
									</span>
								{:else}
									<span class="font-mono text-sm text-fg">{v.value}</span>
								{/if}
							</td>
							<td data-cell="nowrap" class="text-xs text-muted" title={formatDateTime(v.updated_at)}>{relativeTime(v.updated_at)}</td>
							<td>
								<div class="flex items-center gap-2">
									<Button variant="ghost" size="sm" onclick={() => openEdit(v)} title="Edit" aria-label="Edit {v.key}">
										<Pencil size={ICON.sm} />
									</Button>
									<Button variant="ghost" size="sm" onclick={() => askDelete(v)} title="Delete" aria-label="Delete {v.key}">
										<Trash2 size={ICON.sm} class="text-danger" />
									</Button>
								</div>
							</td>
						</tr>
					{/each}
				</tbody>
			</Table>
			<Pagination
				page={pageNumber(data.offset, data.limit)}
				perPage={data.limit}
				count={data.variables.length}
				total={data.total ?? undefined}
				noun="variables"
				href={pageHref('/admin/flows/variables', data.limit)}
			/>
		{/if}
	</PageShell>

	<Drawer bind:open title={editing ? `Edit vars.${editing.key}` : 'New variable'}>
		<form method="POST" action="?/put" id="variable-form" use:enhance={save.enhance} class="flex flex-col gap-4">
			{#if form && 'error' in form && form.error}
				<Alert tone="danger">
					{#snippet children()}{form.error}{/snippet}
				</Alert>
			{/if}
			{#if editing}
				<!-- The key is the variable's name in every expression, so it is not renamed here. -->
				<input type="hidden" name="key" value={editing.key} />
				<input type="hidden" name="existing" value="true" />
				<Input id="variable-key" label="Key" value={key} disabled />
			{:else}
				<Input id="variable-key" name="key" label="Key" placeholder="region" bind:value={key} required />
			{/if}
			{#if secret}
				<PasswordInput
					id="variable-value"
					name="value"
					label={editing?.is_secret ? 'New value' : 'Value'}
					hint={editing?.is_secret ? 'Secrets are write-only. Blank keeps the stored value.' : undefined}
					bind:value
				/>
			{:else}
				<Input id="variable-value" name="value" label="Value" placeholder="eu" bind:value />
			{/if}
			<div>
				<input type="hidden" name="is_secret" value={secret ? 'true' : 'false'} />
				<Toggle id="variable-secret" label="Secret" hint="Stored encrypted and never shown again." bind:checked={secret} />
			</div>
		</form>
		{#snippet footer()}
			<Button variant="secondary" onclick={() => (open = false)}>Cancel</Button>
			<Button variant="primary" type="submit" form="variable-form" loading={save.pending}>{editing ? 'Save' : 'Create'}</Button>
		{/snippet}
	</Drawer>

	<form method="POST" action="?/delete" use:enhance bind:this={deleteForm} class="hidden">
		<input type="hidden" name="key" value={deleteKey} />
	</form>
{:else}
	<PageShell title="Flows" width="wide">
		<NotEnabled title="Flows" description="Variables belong to the flow plugin, and the engine refused its routes." />
	</PageShell>
{/if}
