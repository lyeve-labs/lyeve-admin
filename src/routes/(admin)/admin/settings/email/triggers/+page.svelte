<script lang="ts">
	import PageTitle from '$lib/components/PageTitle.svelte';
	import RefusalNotice from '$lib/components/RefusalNotice.svelte';
	import { formRefusal } from '$lib/api/refusal';
	import { Alert, Badge, Button, Drawer, EmptyState, Input, PageShell, Select, Table, Textarea, Toggle, confirm } from '@lyeve-labs/ui-kit';
	import { MailPlus, Pencil, Plus, Trash2 } from '@lucide/svelte';
	import { enhance } from '$app/forms';
	import { submitter } from '$lib/forms.svelte';
	import type { ActionData, PageData } from './$types';
	import { TRIGGER_EVENT_LABELS, type EmailTrigger } from '$lib/api/email-triggers';
	import NotEnabled from '$lib/components/NotEnabled.svelte';
	import { ICON } from '$lib/icon';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	const pageRefusal = $derived(formRefusal(form));

	const eventLabel = (e: string) => TRIGGER_EVENT_LABELS[e] ?? e;
	const eventOptions = $derived((data.events.length ? data.events : Object.keys(TRIGGER_EVENT_LABELS)).map((e) => ({ value: e, label: eventLabel(e) })));
	const schemaOptions = $derived([{ value: '*', label: 'Every schema' }, ...data.schemas.map((s) => ({ value: s, label: s }))]);
	// A draft or archived template is refused at send time, so the list offers
	// the active ones and says so when there are none.
	const activeTemplates = $derived(data.templates.filter((t) => t.status === 'active'));
	const templateOptions = $derived(activeTemplates.map((t) => ({ value: t.key, label: `${t.key}: ${t.subject}` })));

	// One drawer for both writes. A null target is a new trigger.
	let open = $state(false);
	let editing = $state<EmailTrigger | null>(null);
	let name = $state('');
	let eventName = $state('after_create');
	let schema = $state('*');
	let templateKey = $state('');
	let toStatic = $state('');
	let toField = $state('');
	let locale = $state('');
	let enabled = $state(true);

	function openCreate() {
		editing = null;
		name = '';
		eventName = 'after_create';
		schema = '*';
		templateKey = activeTemplates[0]?.key ?? '';
		toStatic = '';
		toField = 'email';
		locale = '';
		enabled = true;
		open = true;
	}

	function openEdit(t: EmailTrigger) {
		editing = t;
		name = t.name;
		eventName = t.event;
		schema = t.schema;
		templateKey = t.template_key;
		toStatic = t.to_static.join(', ');
		toField = t.to_field;
		locale = t.locale;
		enabled = t.enabled;
		open = true;
	}

	let deleteId = $state('');
	let deleteForm = $state<HTMLFormElement>();

	async function askDelete(t: EmailTrigger) {
		const ok = await confirm('Delete trigger', `Delete ${t.name}? Mail stops going out for this event.`, { confirmLabel: 'Delete' });
		if (!ok) return;
		deleteId = t.id;
		await Promise.resolve();
		deleteForm?.requestSubmit();
	}

	const save = submitter(() => (open = false));

	function recipients(t: EmailTrigger): string {
		const parts = [...t.to_static];
		if (t.to_field) parts.push(`the record's ${t.to_field}`);
		return parts.join(', ');
	}
</script>

<PageTitle title="Email triggers - Settings" />

{#if !data.locked}
	<PageShell
		title="Email triggers"
		description="Send a template when a record is written or a review moves, without building a flow. For a condition or a second step, use a flow with the send templated email node."
		width="wide"
		back={{ href: '/admin/settings/email', label: 'Email' }}
	>
		{#snippet actions()}
			<Button variant="primary" size="sm" onclick={openCreate}>
				<Plus size={ICON.sm} />
				New trigger
			</Button>
		{/snippet}

		{#if data.loadError}
			<Alert tone="danger" title="Triggers could not be loaded">
				{#snippet children()}{data.loadError} Reload once the engine answers again.{/snippet}
			</Alert>
		{/if}
		{#if pageRefusal}
			<RefusalNotice refusal={pageRefusal} />
		{:else if form && 'error' in form && form.error && !open}
			<Alert tone="danger">{#snippet children()}{form.error}{/snippet}</Alert>
		{/if}
		{#if !data.loadError && activeTemplates.length === 0}
			<Alert tone="warn" title="No active template">
				{#snippet children()}A trigger sends an active email template, and this tenant has none. <a class="text-brand underline" href="/admin/settings/email/templates">Create one in Email templates</a> first.{/snippet}
			</Alert>
		{/if}

		{#if data.loadError}
			<!-- Nothing: the empty state would say there are none. -->
		{:else if data.triggers.length === 0}
			<EmptyState title="No triggers yet" description="A trigger sends a template to fixed addresses or to an address the record holds, each time its event fires.">
				{#snippet iconSnippet()}<MailPlus size={ICON.lg} />{/snippet}
				{#snippet action()}
					<Button variant="secondary" onclick={openCreate}>
						<Plus size={ICON.sm} />
						New trigger
					</Button>
				{/snippet}
			</EmptyState>
		{:else}
			<Table label="Email triggers">
				<thead>
					<tr>
						<th scope="col">Name</th>
						<th scope="col">When</th>
						<th scope="col">Template</th>
						<th scope="col">To</th>
						<th scope="col">Actions</th>
					</tr>
				</thead>
				<tbody>
					{#each data.triggers as t (t.id)}
						<tr>
							<td data-cell="nowrap">
								<span class="flex items-center gap-2 text-sm text-fg">
									{t.name}
									{#if !t.enabled}<Badge tone="neutral" size="sm">off</Badge>{/if}
								</span>
							</td>
							<td class="text-sm text-muted">{eventLabel(t.event)} in <span class="font-mono text-xs">{t.schema === '*' ? 'every schema' : t.schema}</span></td>
							<td data-cell="nowrap" class="font-mono text-xs text-fg">{t.template_key}</td>
							<td class="text-sm text-muted">{recipients(t)}</td>
							<td>
								<div class="flex items-center gap-2">
									<Button variant="ghost" size="sm" onclick={() => openEdit(t)} aria-label="Edit {t.name}">
										<Pencil size={ICON.sm} />
									</Button>
									<Button variant="ghost" size="sm" onclick={() => askDelete(t)} aria-label="Delete {t.name}">
										<Trash2 size={ICON.sm} class="text-danger" />
									</Button>
								</div>
							</td>
						</tr>
					{/each}
				</tbody>
			</Table>
		{/if}
	</PageShell>

	<Drawer bind:open title={editing ? `Edit ${editing.name}` : 'New trigger'}>
		<form method="POST" action="?/save" id="trigger-form" use:enhance={save.enhance} class="flex flex-col gap-4">
			{#if pageRefusal}
				<RefusalNotice refusal={pageRefusal} />
			{:else if form && 'error' in form && form.error}
				<Alert tone="danger">{#snippet children()}{form.error}{/snippet}</Alert>
			{/if}
			{#if editing}<input type="hidden" name="id" value={editing.id} />{/if}
			<input type="hidden" name="enabled" value={enabled ? 'true' : 'false'} />
			<Input id="trigger-name" name="name" label="Name" required placeholder="Order confirmation" bind:value={name} />
			<Select id="trigger-event" name="event" label="When" required options={eventOptions} value={eventName} onvaluechange={(v) => (eventName = v)} />
			<Select
				id="trigger-schema"
				name="schema"
				label="In"
				options={schemaOptions}
				value={schema}
				onvaluechange={(v) => (schema = v)}
				hint="The schema whose records it watches. A review event names the schema of the entry under review."
			/>
			<Select
				id="trigger-template"
				name="template_key"
				label="Template"
				required
				options={templateOptions}
				value={templateKey}
				onvaluechange={(v) => (templateKey = v)}
				hint="The record's fields are its variables, plus event, schema and record_id."
			/>
			<Textarea
				id="trigger-to"
				name="to_static"
				label="Send to"
				rows={2}
				placeholder="ops@example.com, sales@example.com"
				hint="Fixed addresses, separated by commas. At most 50 across both lists."
				bind:value={toStatic}
			/>
			<Input
				id="trigger-to-field"
				name="to_field"
				label="And to the address in field"
				placeholder="email"
				mono
				hint="A field of the record that holds an address, such as the customer's email. Leave blank to send to the fixed addresses only."
				bind:value={toField}
			/>
			<Input id="trigger-locale" name="locale" label="Locale" placeholder="en" mono hint="Which translation of the template to send. Blank sends en." bind:value={locale} />
			<Toggle id="trigger-enabled" label="Enabled" hint="A disabled trigger keeps its settings and sends nothing." bind:checked={enabled} />
		</form>
		{#snippet footer()}
			<Button variant="secondary" onclick={() => (open = false)}>Cancel</Button>
			<Button variant="primary" type="submit" form="trigger-form" loading={save.pending}>{editing ? 'Save' : 'Create'}</Button>
		{/snippet}
	</Drawer>

	<form method="POST" action="?/delete" use:enhance bind:this={deleteForm} class="hidden">
		<input type="hidden" name="id" value={deleteId} />
	</form>
{:else}
	<PageShell title="Email triggers" width="wide">
		<NotEnabled title="Email triggers" description="Triggers belong to the email plugin." />
	</PageShell>
{/if}
