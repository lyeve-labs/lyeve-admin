<script lang="ts">
	import PageTitle from '$lib/components/PageTitle.svelte';
	import { Alert, Badge, Button, Drawer, EmptyState, Input, NumberInput, PageShell, Select, Table, confirm as confirmDialog } from '@lyeve-labs/ui-kit';
	import { enhance } from '$app/forms';
	import { tracked } from '$lib/forms.svelte';
	import { Coins, Pencil, Plus, Trash2 } from '@lucide/svelte';
	import type { ActionData, PageData } from './$types';
	import type { ModelPrice } from '$lib/api/ai';
	import AiSection from '$lib/components/ai/AiSection.svelte';
	import { PROVIDER_KINDS, providerKindLabel } from '$lib/api/ai';
	import { formatDateTime } from '$lib/format';
	import { ICON } from '$lib/icon';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const kindOptions = PROVIDER_KINDS.map((k) => ({ value: k, label: providerKindLabel(k) }));
	const keyOf = (kind: string, model: string) => `${kind}/${model}`;

	// One drawer for both writes: a null target is a new price. The kind and
	// the model are the row's key, so an existing row keeps them.
	let open = $state(false);
	let editing = $state<ModelPrice | null>(null);
	let kind = $state<string>('openai');
	let model = $state('');
	let input = $state(0);
	let output = $state(0);
	let image = $state(0);

	function openCreate() {
		editing = null;
		kind = 'openai';
		model = '';
		input = 0;
		output = 0;
		image = 0;
		open = true;
	}

	function openEdit(p: ModelPrice) {
		editing = p;
		kind = p.kind;
		model = p.model;
		input = p.input_per_1k;
		output = p.output_per_1k;
		image = p.image_per_call;
		open = true;
	}

	// The drawer closes once the write is saved. A failure keeps it open
	// beside the message.
	$effect(() => {
		if (form && 'saved' in form && form.saved) open = false;
	});

	// Delete goes through the kit's confirm dialog, then a hidden form, so the
	// row's button never posts on its own and the action stays a form action.
	let deleteTarget = $state<ModelPrice | null>(null);
	let deleteForm = $state<HTMLFormElement>();

	async function askDelete(p: ModelPrice) {
		const ok = await confirmDialog(
			`Delete the price for ${p.model}?`,
			'Its cost is estimated as zero until a row is added again.',
			{ confirmLabel: 'Delete' }
		);
		if (!ok) return;
		deleteTarget = p;
		await Promise.resolve();
		deleteForm?.requestSubmit();
	}

	const canWrite = $derived(data.isSuperAdmin && data.gate.state === 'ok');

	const save = tracked(() => async ({ update }) => update({ reset: false }));
</script>

<PageTitle title="AI prices" />

<PageShell
	title="AI prices"
	description="What a token costs, per kind and model. Every cost estimate on a transcript reads this table. It is per instance."
	width="wide"
>
	{#snippet actions()}
		{#if canWrite}
			<Button variant="primary" size="sm" onclick={openCreate}>
				<Plus size={ICON.sm} aria-hidden="true" /> New price
			</Button>
		{/if}
	{/snippet}

	<AiSection tab="prices" gate={data.gate} layoutGate={data.aiLayoutGate} noun="prices">
		{#if form?.error && !open}
			<Alert tone="danger">{form.error}</Alert>
		{/if}

		{#if data.prices.length === 0}
			<EmptyState
				title="No prices yet"
				description="Without a row for a model its cost is estimated as zero. Prices are dollars per thousand tokens, and per call for an image."
			>
				{#snippet iconSnippet()}
					<Coins size={ICON.lg} />
				{/snippet}
				{#snippet action()}
					{#if canWrite}
						<Button variant="secondary" onclick={openCreate}>
							<Plus size={ICON.sm} aria-hidden="true" /> New price
						</Button>
					{/if}
				{/snippet}
			</EmptyState>
		{:else}
			<Table label="Prices">
				<thead>
					<tr>
						<th scope="col">Kind</th>
						<th scope="col">Model</th>
						<th scope="col">Input per 1K</th>
						<th scope="col">Output per 1K</th>
						<th scope="col">Image per call</th>
						<th scope="col">Updated</th>
						{#if data.isSuperAdmin}<th scope="col" class="text-right">Actions</th>{/if}
					</tr>
				</thead>
				<tbody>
					{#each data.prices as p (keyOf(p.kind, p.model))}
						{@const mine = form?.key === keyOf(p.kind, p.model)}
						<tr>
							<td><Badge tone="violet" size="sm">{providerKindLabel(p.kind)}</Badge></td>
							<td data-cell="nowrap" class="font-medium">{p.model}</td>
							<td data-cell="nowrap" class="font-mono text-muted">${p.input_per_1k}</td>
							<td data-cell="nowrap" class="font-mono text-muted">${p.output_per_1k}</td>
							<td data-cell="nowrap" class="font-mono text-muted">${p.image_per_call}</td>
							<td class="text-muted">
								{formatDateTime(p.updated_at)}
								{#if mine && form && 'saved' in form}
									<span class="block text-xs text-success" role="status">Saved.</span>
								{/if}
							</td>
							{#if data.isSuperAdmin}
								<td class="text-right">
									<span class="inline-flex items-center gap-1">
										<Button variant="ghost" size="sm" onclick={() => openEdit(p)} aria-label="Edit price for {p.model}">
											<Pencil size={ICON.sm} aria-hidden="true" />
										</Button>
										<Button variant="ghost" size="sm" onclick={() => askDelete(p)} aria-label="Delete price for {p.model}">
											<Trash2 size={ICON.sm} aria-hidden="true" class="text-danger" />
										</Button>
									</span>
								</td>
							{/if}
						</tr>
					{/each}
				</tbody>
			</Table>
		{/if}
	</AiSection>
</PageShell>

<Drawer bind:open title={editing ? `Edit ${editing.model}` : 'New price'}>
	<form method="POST" action="?/save" id="price-form" use:enhance={save.enhance} class="flex flex-col gap-4">
		{#if form?.error}
			<Alert tone="danger">{form.error}</Alert>
		{/if}
		{#if editing}
			<input type="hidden" name="kind" value={editing.kind} />
			<input type="hidden" name="model" value={editing.model} />
			<Input id="price-kind" label="Kind" value={providerKindLabel(editing.kind)} disabled />
			<Input id="price-model" label="Model" value={editing.model} disabled />
		{:else}
			<Select id="price-kind" name="kind" label="Kind" options={kindOptions} value={kind} onvaluechange={(v) => (kind = v)} />
			<Input id="price-model" name="model" label="Model" required placeholder="gpt-4o-mini" bind:value={model} />
		{/if}
		<NumberInput id="price-in" name="input_per_1k" label="Input per 1K" min={0} step={0.0001} bind:value={input} />
		<NumberInput id="price-out" name="output_per_1k" label="Output per 1K" min={0} step={0.0001} bind:value={output} />
		<NumberInput id="price-image" name="image_per_call" label="Image per call" min={0} step={0.0001} bind:value={image} />
	</form>
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (open = false)}>Cancel</Button>
		<Button variant="primary" type="submit" form="price-form" loading={save.pending}>{editing ? 'Save' : 'Create'}</Button>
	{/snippet}
</Drawer>

<form method="POST" action="?/delete" use:enhance bind:this={deleteForm} class="hidden">
	<input type="hidden" name="kind" value={deleteTarget?.kind ?? ''} />
	<input type="hidden" name="model" value={deleteTarget?.model ?? ''} />
</form>
