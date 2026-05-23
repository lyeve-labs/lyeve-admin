<script lang="ts">
	import PageTitle from '$lib/components/PageTitle.svelte';
	import RefusalNotice from '$lib/components/RefusalNotice.svelte';
	import { formRefusal } from '$lib/api/refusal';
	import { Alert, Badge, Button, Drawer, EmptyState, Input, Modal, PageShell, SegmentedControl, Select, Table, Textarea, confirm } from '@lyeve-labs/ui-kit';
	import { Eye, Lock, Mail, Pencil, Plus, Trash2 } from '@lucide/svelte';
	import { enhance } from '$app/forms';
	import { submitter } from '$lib/forms.svelte';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { ActionData, PageData } from './$types';
	import { REQUIRED_PURPOSE, type EmailTemplate, type TemplateStatus } from '$lib/api/email-templates';
	import { ICON } from '$lib/icon';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	const pageRefusal = $derived(formRefusal(form));
	const formError = $derived(form && 'error' in form && typeof form.error === 'string' ? form.error : '');

	// The plugin states the ceiling and the count. A limit of 0 is none, and
	// a read that failed states nothing: the create still answers the ceiling.
	const limit = $derived(data.limits?.limit ?? 0);
	const atCeiling = $derived(limit > 0 && (data.limits?.current ?? 0) >= limit);
	const optionalStarters = $derived(data.starters.filter((s) => !s.required));
	const starterOptions = $derived([{ value: '', label: 'A blank template' }, ...optionalStarters.map((s) => ({ value: s.key, label: s.key }))]);
	const STATUS_OPTIONS = [
		{ value: 'active', label: 'Active' },
		{ value: 'draft', label: 'Draft' },
		{ value: 'archived', label: 'Archived' },
	];
	const BLANK = `<mjml>
<mj-body>
<mj-section>
<mj-column>
<mj-text>Hello {{.Vars.name}}</mj-text>
</mj-column>
</mj-section>
</mj-body>
</mjml>`;

	// One drawer for both writes. A null target is a new template.
	let open = $state(false);
	let editing = $state<EmailTemplate | null>(null);
	let key = $state('');
	let starter = $state('');
	let subject = $state('');
	let body = $state('');
	let status = $state<TemplateStatus>('active');

	function openCreate() {
		editing = null;
		key = '';
		starter = '';
		subject = '';
		body = BLANK;
		status = 'active';
		open = true;
	}

	function openEdit(t: EmailTemplate) {
		editing = t;
		key = t.key;
		subject = t.subject;
		body = t.mjml_source;
		status = t.status;
		open = true;
	}

	// Picking a starter copies its subject and body into the form, and its
	// name when the author has not typed one.
	function pickStarter(value: string) {
		starter = value;
		const s = optionalStarters.find((x) => x.key === value);
		if (!s) {
			body = BLANK;
			return;
		}
		subject = s.subject;
		body = s.mjml_source;
		if (!key) key = s.key;
	}

	const linkVariable = $derived(editing?.required ? data.starters.find((s) => s.key === editing?.key)?.link_variable : undefined);

	let deleteId = $state('');
	let deleteForm = $state<HTMLFormElement>();

	async function askDelete(t: EmailTemplate) {
		const ok = await confirm('Delete template', `Delete ${t.key}? A trigger or a flow that sends it stops sending.`, { confirmLabel: 'Delete' });
		if (!ok) return;
		deleteId = t.id;
		await Promise.resolve();
		deleteForm?.requestSubmit();
	}

	let previewKey = $state('');
	let previewForm = $state<HTMLFormElement>();
	let previewOpen = $state(false);
	const preview = $derived(form && 'preview' in form ? form.preview : null);
	const showPreview: SubmitFunction = () => {
		return async ({ update }) => {
			await update({ reset: false });
			previewOpen = true;
		};
	};

	async function askPreview(t: EmailTemplate) {
		previewKey = t.key;
		await Promise.resolve();
		previewForm?.requestSubmit();
	}

	const save = submitter(() => (open = false));
</script>

<PageTitle title="Email templates - Settings" />

<PageShell
	title="Email templates"
	description="The subject and body each mail is sent with. Edit every word, start from a ready-made template, and preview it with sample values before it goes out."
	width="wide"
	back={{ href: '/admin/settings/email', label: 'Email' }}
>
	{#snippet actions()}
		{#if data.limits}
			<span class="text-sm text-muted" data-testid="template-usage">
				{limit > 0 ? `${data.limits.current} of ${limit} templates` : `${data.limits.current} templates, no limit`}
			</span>
		{/if}
		<Button variant="primary" size="sm" onclick={openCreate} disabled={atCeiling || Boolean(data.loadError)}>
			<Plus size={ICON.sm} />
			New template
		</Button>
	{/snippet}

	{#if data.loadError}
		<Alert tone="danger" title="Templates could not be loaded">
			{#snippet children()}{data.loadError} Reload once the engine answers again.{/snippet}
		</Alert>
	{/if}
	{#if pageRefusal && !open}
		<RefusalNotice refusal={pageRefusal} />
	{:else if formError && !open}
		<Alert tone="danger">{#snippet children()}{formError}{/snippet}</Alert>
	{/if}
	{#if atCeiling}
		<Alert tone="info" title="Every template slot is in use">
			{#snippet children()}This instance holds {limit} templates. Edit one, delete one you no longer send, or change the license to hold more.{/snippet}
		</Alert>
	{/if}

	{#if data.loadError}
		<!-- Nothing: the empty state would say there are none. -->
	{:else if data.templates.length === 0}
		<EmptyState title="No templates yet" description="A template is the subject and body a mail is sent with.">
			{#snippet iconSnippet()}<Mail size={ICON.lg} />{/snippet}
		</EmptyState>
	{:else}
		<Table label="Email templates">
			<thead>
				<tr>
					<th scope="col">Name</th>
					<th scope="col">Subject</th>
					<th scope="col">Status</th>
					<th scope="col">Actions</th>
				</tr>
			</thead>
			<tbody>
				{#each data.templates as t (t.id)}
					<tr>
						<td data-cell="nowrap">
							<span class="flex items-center gap-2">
								<span class="font-mono text-xs text-fg">{t.key}</span>
								{#if t.required}
									<Badge tone="brand" size="sm"><Lock size={ICON.xs} aria-hidden="true" /> Required</Badge>
								{/if}
							</span>
							{#if t.required && REQUIRED_PURPOSE[t.key]}
								<span class="block text-xs text-faint">{REQUIRED_PURPOSE[t.key]}</span>
							{/if}
						</td>
						<td class="text-sm text-muted">{t.subject}</td>
						<td data-cell="nowrap">
							<Badge tone={t.status === 'active' ? 'success' : 'neutral'} size="sm">{t.status}</Badge>
						</td>
						<td>
							<div class="flex items-center gap-2">
								<Button variant="ghost" size="sm" onclick={() => askPreview(t)} aria-label="Preview {t.key}">
									<Eye size={ICON.sm} />
								</Button>
								<Button variant="ghost" size="sm" onclick={() => openEdit(t)} aria-label="Edit {t.key}">
									<Pencil size={ICON.sm} />
								</Button>
								{#if !t.required}
									<Button variant="ghost" size="sm" onclick={() => askDelete(t)} aria-label="Delete {t.key}">
										<Trash2 size={ICON.sm} class="text-danger" />
									</Button>
								{/if}
							</div>
						</td>
					</tr>
				{/each}
			</tbody>
		</Table>
	{/if}
</PageShell>

<Drawer bind:open title={editing ? `Edit ${editing.key}` : 'New template'}>
	<form method="POST" action="?/save" id="template-form" use:enhance={save.enhance} class="flex flex-col gap-4">
		{#if pageRefusal}
			<RefusalNotice refusal={pageRefusal} />
		{:else if formError}
			<Alert tone="danger">{#snippet children()}{formError}{/snippet}</Alert>
		{/if}
		{#if editing}
			<input type="hidden" name="id" value={editing.id} />
		{:else}
			<Select
				id="template-starter"
				label="Start from"
				options={starterOptions}
				value={starter}
				onvaluechange={pickStarter}
				hint="A ready-made template to copy. Everything it copies stays yours to change."
			/>
			<Input id="template-key" name="key" label="Name" required mono placeholder="order-shipped" hint="How a trigger or a flow names it. Lower case letters, digits and dashes." bind:value={key} />
		{/if}
		{#if editing?.required}
			<Alert tone="info" title="Required template">
				{#snippet children()}
					{REQUIRED_PURPOSE[editing?.key ?? ''] ?? 'A sign-in mail is sent from it.'} Change any word or the whole design. Keep
					<code class="font-mono text-xs">{`{{.Vars.${linkVariable ?? 'link'}}}`}</code> in the body, because it is the link the mail delivers.
				{/snippet}
			</Alert>
			<input type="hidden" name="status" value="active" />
		{:else}
			<input type="hidden" name="status" value={status} />
			<SegmentedControl label="Status" bind:value={status} options={STATUS_OPTIONS} />
		{/if}
		<Input id="template-subject" name="subject" label="Subject" required placeholder={'Your order has shipped, {{.Vars.name}}'} bind:value={subject} />
		<Textarea
			id="template-body"
			name="mjml_source"
			label="Body"
			rows={18}
			mono
			hint={'MJML markup. Print a value with {{.Vars.name}} and your branding with {{.Branding.CompanyName}}, {{.Branding.LogoURL}} or {{.Branding.PrimaryColor}}. At most 16 KiB.'}
			bind:value={body}
		/>
	</form>
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (open = false)}>Cancel</Button>
		<Button variant="primary" type="submit" form="template-form" loading={save.pending}>{editing ? 'Save' : 'Create'}</Button>
	{/snippet}
</Drawer>

<Modal bind:open={previewOpen} title={preview ? `Preview of ${preview.key}` : 'Preview'} size="xl">
	{#if preview}
		<p class="mb-3 text-sm text-muted">Subject: <span class="text-fg">{preview.subject}</span></p>
		<!-- An empty sandbox runs no script and reaches nothing of the admin's. -->
		<!-- ui-consistency: allow raw-color - a mail client draws a message on white, so its preview is drawn on white in either theme -->
		<iframe title="Rendered {preview.key}" sandbox="" srcdoc={preview.html} class="h-[60vh] w-full rounded border border-line bg-white" data-testid="template-preview"></iframe>
		<p class="mt-2 text-xs text-faint">Rendered with sample values. Images from other sites are not loaded here.</p>
	{/if}
</Modal>

<form method="POST" action="?/delete" use:enhance bind:this={deleteForm} class="hidden">
	<input type="hidden" name="id" value={deleteId} />
</form>
<form method="POST" action="?/preview" use:enhance={showPreview} bind:this={previewForm} class="hidden">
	<input type="hidden" name="key" value={previewKey} />
</form>
