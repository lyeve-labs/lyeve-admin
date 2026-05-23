<script lang="ts">
	import PageTitle from '$lib/components/PageTitle.svelte';
	import RefusalNotice from '$lib/components/RefusalNotice.svelte';
	import { formRefusal } from '$lib/api/refusal';
	import {
		Alert,
		Badge,
		Button,
		Card,
		Drawer,
		EmptyState,
		Input,
		PageShell,
		PasswordInput,
		SearchInput,
		SegmentedControl,
		Select,
		Textarea,
		Toggle,
		confirm as confirmDialog
	} from '@lyeve-labs/ui-kit';
	import type { PageData, ActionData } from './$types';
	import type { IncomingWebhook } from '@lyeve-labs/client';
	import { enhance } from '$app/forms';
	import { submitter } from '$lib/forms.svelte';
	import { Plus, Pencil, Trash2, ArrowDownToLine } from '@lucide/svelte';
	import ListToolbar from '$lib/components/ListToolbar.svelte';
	import { narrows } from '$lib/narrow';
	import { ICON } from '$lib/icon';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	const pageRefusal = $derived(formRefusal(form));

	const submit = submitter(() => (open = false));

	const schemaOptions = $derived(data.schemas.map((s) => ({ value: s.name, label: s.name })));

	// One drawer for both writes: a null target is a new endpoint.
	let open = $state(false);
	let editing = $state<IncomingWebhook | null>(null);
	let name = $state('');
	let schema = $state('');
	let secret = $state('');
	let fieldMap = $state('{}');
	let enabled = $state(true);
	let allowedIPs = $state('');

	function openCreate() {
		editing = null;
		name = '';
		schema = data.schemas[0]?.name ?? '';
		secret = '';
		fieldMap = '{\n  "external_field": "schema_field"\n}';
		enabled = true;
		allowedIPs = '';
		open = true;
	}

	function openEdit(wh: IncomingWebhook) {
		editing = wh;
		name = wh.name;
		schema = wh.schema_name;
		secret = '';
		fieldMap = JSON.stringify(wh.field_map ?? {}, null, 2);
		enabled = wh.enabled;
		allowedIPs = (wh.allowed_ips ?? []).join('\n');
		open = true;
	}

	// Delete goes through the kit's confirm dialog, then a hidden form, so the
	// row's button never posts on its own and the action stays a form action.
	let deleteId = $state('');
	let deleteForm = $state<HTMLFormElement>();

	async function askDelete(wh: IncomingWebhook) {
		const ok = await confirmDialog(
			`Delete ${wh.name}?`,
			'External services can no longer send payloads to this endpoint.',
			{ confirmLabel: 'Delete' }
		);
		if (!ok) return;
		deleteId = wh.id;
		await Promise.resolve();
		deleteForm?.requestSubmit();
	}

	// The endpoint takes no search, so the box narrows what is on screen.
	let query = $state('');
	let status = $state('');
	const STATUSES = [
		{ value: '', label: 'All' },
		{ value: 'enabled', label: 'Enabled' },
		{ value: 'disabled', label: 'Disabled' },
	];
	const visible = $derived(
		data.incomingWebhooks.filter(
			(wh) =>
				narrows(query, wh.name, wh.schema_name, wh.id) &&
				(status === '' || (status === 'enabled') === wh.enabled)
		)
	);
</script>

<PageTitle title="Incoming webhooks" />

<PageShell
	title="Incoming webhooks"
	description="Public HTTP endpoints that accept payloads from external services and create content records."
	width="wide"
>
	{#snippet actions()}
		<Button variant="primary" size="sm" onclick={openCreate}>
			<Plus size={ICON.sm} />
			New incoming webhook
		</Button>
	{/snippet}

	{#if pageRefusal}
		<RefusalNotice refusal={pageRefusal} />
	{:else if form && 'error' in form && form.error}
		<Alert tone="danger">
			{#snippet children()}{form.error}{/snippet}
		</Alert>
	{/if}

	{#if data.incomingWebhooks.length === 0}
		<EmptyState
			title="No incoming webhooks"
			description="Create one to receive payloads from external services."
		>
			{#snippet iconSnippet()}<ArrowDownToLine size={ICON.lg} />{/snippet}
			{#snippet action()}
				<Button variant="secondary" onclick={openCreate}>
					<Plus size={ICON.sm} />
					New incoming webhook
				</Button>
			{/snippet}
		</EmptyState>
	{:else}
		<ListToolbar label="Filter incoming webhooks">
			{#snippet search()}
				<label for="incoming-search" class="sr-only">Narrow the list</label>
				<SearchInput id="incoming-search" bind:value={query} placeholder="Name, schema or id" />
			{/snippet}
			{#snippet filters()}
				<SegmentedControl label="Status" labelHidden bind:value={status} options={STATUSES} />
			{/snippet}
		</ListToolbar>

		{#if visible.length === 0}
			<EmptyState title="No incoming webhook matches" description="Clear the search or widen the status to see every endpoint." />
		{:else}
		<div class="flex flex-col gap-3">
			{#each visible as wh (wh.id)}
				<Card>
					<div class="flex items-center gap-4">
						<div class="min-w-0 flex-1">
							<div class="flex items-center gap-2">
								<span class="truncate font-semibold text-fg">{wh.name}</span>
								<Badge tone={wh.enabled ? 'success' : 'neutral'} dot>
									{wh.enabled ? 'Enabled' : 'Disabled'}
								</Badge>
							</div>
							<div class="mt-1 flex flex-wrap items-center gap-4 text-xs text-muted">
								<span>Schema: <span class="font-mono text-fg">{wh.schema_name}</span></span>
								<span>
									POST /api/v1/webhooks/in/<span class="font-mono text-fg">{wh.id}</span>
								</span>
							</div>
							{#if wh.allowed_ips && wh.allowed_ips.length > 0}
								<div class="mt-1 flex flex-wrap gap-1">
									{#each wh.allowed_ips as ip (ip)}
										<Badge tone="neutral">
											<span class="font-mono">{ip}</span>
										</Badge>
									{/each}
								</div>
							{/if}
						</div>
						<div class="flex shrink-0 items-center gap-2">
							<Button
								variant="ghost"
								size="sm"
								onclick={() => openEdit(wh)}
								title="Edit"
								aria-label="Edit {wh.name}"
							>
								<Pencil size={ICON.sm} />
							</Button>
							<Button
								variant="ghost"
								size="sm"
								onclick={() => askDelete(wh)}
								title="Delete"
								aria-label="Delete {wh.name}"
							>
								<Trash2 size={ICON.sm} class="text-danger" />
							</Button>
						</div>
					</div>
				</Card>
			{/each}
		</div>
		{/if}
	{/if}
</PageShell>

<Drawer bind:open title={editing ? `Edit ${editing.name}` : 'New incoming webhook'}>
	{#if pageRefusal}
		<div class="mb-4"><RefusalNotice refusal={pageRefusal} /></div>
	{/if}
	<form
		method="POST"
		action={editing ? '?/update' : '?/create'}
		id="incoming-form"
		use:enhance={submit.enhance}
		class="flex flex-col gap-4"
	>
		{#if editing}<input type="hidden" name="id" value={editing.id} />{/if}
		<Input id="incoming-name" name="name" label="Name" required bind:value={name} placeholder="Stripe events" />
		<Select
			id="incoming-schema"
			name="schema_name"
			label="Target schema"
			required
			options={schemaOptions}
			value={schema}
			onvaluechange={(v) => (schema = v)}
		/>
		<PasswordInput
			id="incoming-secret"
			name="secret"
			label={editing ? 'New signing secret' : 'Signing secret'}
			hint={editing ? 'Leave blank to keep current' : 'Leave blank to disable signature verification'}
			bind:value={secret}
		/>
		<Textarea
			id="incoming-fieldmap"
			name="field_map"
			label="Field map"
			required
			hint="JSON map of external key to schema field. At least one mapping is required. The engine rejects an empty map."
			rows={4}
			bind:value={fieldMap}
			mono
		/>
		<Textarea
			id="incoming-allowed-ips"
			name="allowed_ips"
			label="IP allowlist"
			hint="One IP or CIDR per line. Leave empty to allow all."
			rows={3}
			bind:value={allowedIPs}
			placeholder="10.0.0.0/8"
		/>
		<div>
			<input type="hidden" name="enabled" value={enabled ? 'true' : 'false'} />
			<Toggle id="incoming-enabled" label="Enabled" bind:checked={enabled} />
		</div>
	</form>
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (open = false)}>Cancel</Button>
		<Button variant="primary" type="submit" form="incoming-form" loading={submit.pending}>{editing ? 'Save' : 'Create'}</Button>
	{/snippet}
</Drawer>

<form method="POST" action="?/delete" use:enhance bind:this={deleteForm} class="hidden">
	<input type="hidden" name="id" value={deleteId} />
</form>
