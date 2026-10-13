<script lang="ts">
	import PageTitle from '$lib/components/PageTitle.svelte';
	import RefusalNotice from '$lib/components/RefusalNotice.svelte';
	import FormErrors from '$lib/components/FormErrors.svelte';
	import { formRefusal } from '$lib/api/refusal';
	import { Alert, Badge, Button, Drawer, EmptyState, Input, PageShell, Select, Table, Textarea, Toggle, confirm } from '@lyeve-labs/ui-kit';
	import { MailPlus, Pencil, Plus, Trash2 } from '@lucide/svelte';
	import { enhance } from '$app/forms';
	import { tick } from 'svelte';
	import { submitter } from '$lib/forms.svelte';
	import type { ActionData, PageData } from './$types';
	import { TRIGGER_EVENT_LABELS, type EmailTrigger } from '$lib/api/email-triggers';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import { ICON } from '$lib/icon';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	/*
	 * The drawer and the delete report through the one `form`, so each failure
	 * names the action that caused it. The drawer shows only a failed save, and
	 * only one that came back after it opened, so a failed delete never reads
	 * as a failure of the next form opened. A failed delete shows above the list.
	 */
	const failure = $derived(form as { action?: string; error?: string } | null);
	let openedOver = $state.raw<unknown>(null);
	const saveFailure = $derived(failure?.action === 'save' && form !== openedOver ? failure : null);
	const deleteFailure = $derived(failure?.action === 'delete' ? failure : null);
	const pageRefusal = $derived(deleteFailure ? formRefusal(deleteFailure) : null);

	const eventLabel = (e: string) => TRIGGER_EVENT_LABELS[e] ?? e;
	const triggers = $derived(data.triggers.ok ? data.triggers.value.triggers : []);
	const events = $derived(data.triggers.ok ? data.triggers.value.events : []);
	const eventOptions = $derived((events.length ? events : Object.keys(TRIGGER_EVENT_LABELS)).map((e) => ({ value: e, label: eventLabel(e) })));
	const schemaNames = $derived(data.schemas.ok ? data.schemas.value : []);
	const schemaOptions = $derived([{ value: '*', label: 'Every schema' }, ...schemaNames.map((s) => ({ value: s, label: s }))]);
	// A draft or archived template is refused at send time, so the list offers
	// the active ones and says so when there are none. A list that did not
	// answer says nothing about how many there are.
	const activeTemplates = $derived(data.templates.ok ? data.templates.value.filter((t) => t.status === 'active') : []);
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
		openedOver = form;
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
		openedOver = form;
		open = true;
	}

	let deleteId = $state('');
	let deleteForm = $state<HTMLFormElement>();

	async function askDelete(t: EmailTrigger) {
		const ok = await confirm(`Delete trigger ${t.name}`, 'Mail stops going out for this event.', { confirmLabel: 'Delete' });
		if (!ok) return;
		deleteId = t.id;
		await tick();
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

<PageShell
	title="Email triggers"
	description="Send a template when a record is written or a review moves, without building a flow. For a condition or a second step, use a flow with the send templated email node."
	width="wide"
	back={{ href: '/admin/settings/email', label: 'Email' }}
>
	{#snippet actions()}
		{#if data.triggers.ok}
			<Button variant="primary" size="sm" onclick={openCreate}>
				<Plus size={ICON.sm} />
				New trigger
			</Button>
		{/if}
	{/snippet}

	{#if pageRefusal}
		<RefusalNotice refusal={pageRefusal} />
	{:else if deleteFailure?.error}
		<Alert tone="danger">{#snippet children()}{deleteFailure.error}{/snippet}</Alert>
	{/if}
	{#if data.triggers.ok && !data.templates.ok}
		<GateNotice gate={data.templates.gate} title="Email templates" absent="This version of the email plugin keeps no templates." />
	{:else if data.triggers.ok && activeTemplates.length === 0}
		<Alert tone="warn" title="No active template">
			{#snippet children()}A trigger sends an active email template, and this tenant has none. <a class="text-brand underline" href="/admin/settings/email/templates">Create one in Email templates</a> first.{/snippet}
		</Alert>
	{/if}

	{#if !data.triggers.ok}
		<GateNotice gate={data.triggers.gate} title="Email triggers" absent="This version of the email plugin has no triggers." />
	{:else if triggers.length === 0}
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
				{#each triggers as t (t.id)}
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
		<FormErrors message={saveFailure?.error} />
		{#if editing}<input type="hidden" name="id" value={editing.id} />{/if}
		<input type="hidden" name="enabled" value={enabled ? 'true' : 'false'} />
		<Input id="trigger-name" name="name" label="Name" required placeholder="Order confirmation" bind:value={name} />
		<Select id="trigger-event" name="event" label="When" required searchable options={eventOptions} value={eventName} onvaluechange={(v) => (eventName = v)} />
		<Select
			id="trigger-schema"
			name="schema"
			label="In"
			searchable
			options={schemaOptions}
			value={schema}
			onvaluechange={(v) => (schema = v)}
			hint={data.schemas.ok
			? 'The schema whose records it watches. A review event names the schema of the entry under review.'
			: 'The schemas could not be read, so only every schema is offered. Reload the page to pick one.'}
		/>
		<Select
			id="trigger-template"
			name="template_key"
			label="Template"
			required
			searchable
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
