<script lang="ts">
	import PageTitle from '$lib/components/PageTitle.svelte';
	import RefusalNotice from '$lib/components/RefusalNotice.svelte';
	import { formRefusal } from '$lib/api/refusal';
	import {
		Alert,
		Badge,
		Button,
		Drawer,
		EmptyState,
		Input,
		PageShell,
		PasswordInput,
		SectionHeading,
		Card,
		Select,
		Table,
		Textarea,
		Toggle,
		confirm,
	} from '@lyeve-labs/ui-kit';
	import { Copy, FileText, Lock, Mail, Pencil, Plus, Terminal, Trash2, MailPlus } from '@lucide/svelte';
	import { duplicateRow } from '$lib/duplicate';
	import SettingRow from '$lib/components/SettingRow.svelte';
	import type { ConfigSetting } from './+page.server';
	import { enhance } from '$app/forms';
	import type { ActionData, PageData } from './$types';
	import { API_METHODS, BODY_PLACEHOLDERS, WEBHOOK_EVENTS, webhookPath, type EmailProvider } from '$lib/api/email';
	import { submitter } from '$lib/forms.svelte';
	import { ICON } from '$lib/icon';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	const pageRefusal = $derived(formRefusal(form));

	const submit = submitter(() => (open = false));

	const mail = $derived(data.mail ?? []);

	// SettingRow matches a save's outcome to a row by key, and the provider
	// actions on this page report through the same `form`. A provider failure
	// carries no key, so it cannot be mistaken for a setting's.
	const settingResult = $derived(
		(form ?? null) as { key?: string; error?: string; success?: boolean } | null
	);

	function settingLabel(key: string): string {
		return key.replace(/^SMTP_/, '').toLowerCase();
	}

	function settingHint(setting: ConfigSetting): string {
		if (setting.source === 'env') return 'Set by an environment variable, which always wins.';
		if (setting.source === 'file') {
			return setting.origin
				? `Pinned by ${setting.origin}. Tag the value !overridable to edit it here.`
				: 'Pinned by the configuration file. Tag the value !overridable to edit it here.';
		}
		return '';
	}

	const TRANSPORT_OPTIONS = [
		{ value: 'smtp', label: 'SMTP' },
		{ value: 'api', label: 'Provider API' },
	];
	const STATUS_OPTIONS = [
		{ value: 'active', label: 'Active' },
		{ value: 'paused', label: 'Paused' },
	];
	const METHOD_OPTIONS = API_METHODS.map((m) => ({ value: m, label: m }));
	const EVENT_OPTIONS = WEBHOOK_EVENTS.map((e) => ({ value: e, label: e }));

	type Row = { key: string; value: string };

	let open = $state(false);
	let editing = $state<EmailProvider | null>(null);
	let transport = $state<string | null>('smtp');
	let status = $state<string | null>('active');
	let host = $state('');
	let port = $state('587');
	// The name is state rather than read from `editing`: a duplicate has a
	// name and no row behind it, so a field reading the row opens blank.
	let providerName = $state('');
	let username = $state('');
	let useTLS = $state(true);
	let apiBaseUrl = $state('');
	let apiMethod = $state<string | null>('POST');
	let apiPath = $state('');
	let apiHeaders = $state<Row[]>([]);
	let apiBody = $state('');
	let apiMessageIdPath = $state('');
	let webhookEventPath = $state('');
	let webhookRecipientPath = $state('');
	let webhookMessageIdPath = $state('');
	let webhookReasonPath = $state('');
	let eventMap = $state<Row[]>([]);

	function rows(map: Record<string, string> | undefined): Row[] {
		return Object.entries(map ?? {}).map(([key, value]) => ({ key, value }));
	}

	function openCreate() {
		editing = null;
		providerName = '';
		transport = 'smtp';
		status = 'active';
		host = '';
		port = '587';
		username = '';
		useTLS = true;
		apiBaseUrl = '';
		apiMethod = 'POST';
		apiPath = '';
		apiHeaders = [];
		apiBody = '';
		apiMessageIdPath = '';
		webhookEventPath = '';
		webhookRecipientPath = '';
		webhookMessageIdPath = '';
		webhookReasonPath = '';
		eventMap = [];
		open = true;
	}

	function openEdit(p: EmailProvider) {
		editing = p;
		providerName = p.name;
		transport = p.transport;
		status = p.status === 'paused' ? 'paused' : 'active';
		host = p.host;
		port = p.port ? String(p.port) : '587';
		username = p.username ?? '';
		useTLS = p.use_tls;
		apiBaseUrl = p.api_base_url ?? '';
		apiMethod = p.api_method || 'POST';
		apiPath = p.api_path ?? '';
		apiHeaders = rows(p.api_headers);
		apiBody = p.api_body ?? '';
		apiMessageIdPath = p.api_message_id_path ?? '';
		webhookEventPath = p.api_webhook_event_path ?? '';
		webhookRecipientPath = p.api_webhook_recipient_path ?? '';
		webhookMessageIdPath = p.api_webhook_message_id_path ?? '';
		webhookReasonPath = p.api_webhook_reason_path ?? '';
		eventMap = rows(p.api_webhook_event_map);
		open = true;
	}

	/**
	 * Copy a provider into the create drawer.
	 *
	 * Everything about how mail leaves travels. The credential does not: the
	 * plugin holds it encrypted and never sends it back, so the copy asks for
	 * one. The copy also arrives paused, because a second provider in the pool
	 * starts taking sends as soon as it is active and nobody has checked yet
	 * that this one authenticates.
	 */
	function openDuplicate(source: EmailProvider) {
		const draft = duplicateRow(source as unknown as Record<string, unknown>, {
			taken: data.providers.map((x) => x.name),
		});
		editing = null;
		providerName = String(draft.name ?? source.name);
		transport = source.transport;
		status = 'paused';
		host = source.host;
		port = source.port ? String(source.port) : '587';
		username = source.username ?? '';
		useTLS = source.use_tls;
		apiBaseUrl = source.api_base_url ?? '';
		apiMethod = source.api_method || 'POST';
		apiPath = source.api_path ?? '';
		apiHeaders = rows(source.api_headers);
		apiBody = source.api_body ?? '';
		apiMessageIdPath = source.api_message_id_path ?? '';
		webhookEventPath = source.api_webhook_event_path ?? '';
		webhookRecipientPath = source.api_webhook_recipient_path ?? '';
		webhookMessageIdPath = source.api_webhook_message_id_path ?? '';
		webhookReasonPath = source.api_webhook_reason_path ?? '';
		eventMap = rows(source.api_webhook_event_map);
		open = true;
	}

	const isApi = $derived(transport === 'api');

	// The plugin holds a secret only for the stored transport, so only that
	// one can be left blank: a new row or a transport change needs it typed.
	const passwordKept = $derived(editing !== null && editing.transport === 'smtp');
	const keyKept = $derived(editing !== null && editing.transport === 'api');
	const keptHint = 'Stored and never shown. Leave blank to keep it.';
	const keyHint = $derived(
		keyKept ? keptHint : editing ? 'The transport changed, so a key is needed.' : 'Encrypted at rest and never echoed back.',
	);

	let deleteId = $state('');
	let deleteForm = $state<HTMLFormElement>();

	async function askDelete(p: EmailProvider) {
		const ok = await confirm(`Delete ${p.name}?`, 'Sends that rotate onto it will go to the next provider.', {
			confirmLabel: 'Delete',
		});
		if (!ok) return;
		deleteId = p.id;
		await Promise.resolve();
		deleteForm?.requestSubmit();
	}

	function endpoint(p: EmailProvider): string {
		return p.transport === 'api' ? p.api_base_url ?? '' : p.host;
	}

	const placeholderHint = `A JSON template. ${BODY_PLACEHOLDERS.map((p) => `{{${p}}}`).join(', ')} are substituted at send time; {{to}} is an array of addresses, {{to_first}} its first address and {{to_objects}} the same list as objects with an email key.`;
</script>

<PageTitle title="Email providers" />

<PageShell
	title="Email"
	description="How this instance sends mail. The provider pool is tried first, and the fallback transport below it catches anything the pool cannot send."
	width="wide"
	back={{ href: '/admin/settings', label: 'Settings' }}
>
	{#snippet actions()}
		<Badge tone="violet" size="sm">Beta</Badge>
		{#if !data.unavailable}
			<Button variant="secondary" size="sm" href="/admin/settings/email/templates">
				<FileText size={ICON.sm} />
				Templates
			</Button>
			<Button variant="secondary" size="sm" href="/admin/settings/email/triggers">
				<MailPlus size={ICON.sm} />
				Triggers
			</Button>
			<Button variant="primary" size="sm" onclick={openCreate}>
				<Plus size={ICON.sm} />
				New provider
			</Button>
		{/if}
	{/snippet}

	<section class="flex flex-col gap-4">
		<SectionHeading level={2}>Provider pool</SectionHeading>
		<p class="text-sm text-muted">
			An SMTP server, or a provider's HTTP API with a key. The lowest priority that is healthy
			sends first, and a provider saved here joins the rotation straight away.
		</p>

	{#if data.unavailable}
		<Alert tone="warn" title="The email plugin did not answer">
			The engine lists the plugin, but its routes are not responding. Providers cannot be read or
			written until it is.
		</Alert>
	{:else}
		{#if pageRefusal}
			<RefusalNotice refusal={pageRefusal} />
		{:else if form?.error}
			<Alert tone="danger">{form.error}</Alert>
		{/if}

		{#if data.providers.length === 0}
			<EmptyState
				title="No providers yet"
				description="Until one exists, mail goes through the fallback transport below, if it is set."
			>
				{#snippet iconSnippet()}<Mail size={ICON.lg} />{/snippet}
				{#snippet action()}
					<Button variant="secondary" onclick={openCreate}>
						<Plus size={ICON.sm} />
						New provider
					</Button>
				{/snippet}
			</EmptyState>
		{:else}
			<Table label="Email providers">
				<thead>
					<tr>
						<th scope="col">Name</th>
						<th scope="col">Transport</th>
						<th scope="col">Endpoint</th>
						<th scope="col">From</th>
						<th scope="col">Delivery webhook</th>
						<th scope="col">Priority</th>
						<th scope="col">Status</th>
						<th scope="col">Actions</th>
					</tr>
				</thead>
				<tbody>
					{#each data.providers as p (p.id)}
						<tr>
							<td data-cell="nowrap" class="text-sm text-fg">{p.name}</td>
							<td data-cell="nowrap">
								<Badge tone={p.transport === 'api' ? 'brand' : 'neutral'} size="sm">{p.transport === 'api' ? 'API' : 'SMTP'}</Badge>
							</td>
							<td data-cell="nowrap" class="font-mono text-xs text-muted">{endpoint(p)}</td>
							<td data-cell="nowrap" class="text-sm text-muted">{p.from_addr}</td>
							<td data-cell="nowrap" class="font-mono text-xs text-muted">
								{#if p.transport === 'api'}{webhookPath(p.id)}{:else}<span class="text-faint">none</span>{/if}
							</td>
							<td data-cell="nowrap" class="text-sm text-muted">{p.priority}</td>
							<td data-cell="nowrap">
								<Badge tone={p.status === 'active' ? 'success' : p.status === 'degraded' ? 'danger' : 'neutral'} size="sm">{p.status}</Badge>
							</td>
							<td>
								<div class="flex items-center gap-2">
									<Button variant="ghost" size="sm" onclick={() => openEdit(p)} title="Edit" aria-label="Edit {p.name}">
										<Pencil size={ICON.sm} />
									</Button>
									<Button variant="ghost" size="sm" onclick={() => openDuplicate(p)} title="Duplicate" aria-label="Duplicate {p.name}">
										<Copy size={ICON.sm} />
									</Button>
									<Button variant="ghost" size="sm" onclick={() => askDelete(p)} title="Delete" aria-label="Delete {p.name}">
										<Trash2 size={ICON.sm} class="text-danger" />
									</Button>
								</div>
							</td>
						</tr>
					{/each}
				</tbody>
			</Table>
		{/if}
	{/if}
	</section>

	<!-- Not a second way to configure the pool above. The sign-in and reset
	     mailers dial these settings themselves when no provider can send, so
	     the section shows whether or not the pool is available. -->
	{#if mail.length > 0}
		<section class="flex flex-col gap-4">
			<SectionHeading level={2}>Fallback transport</SectionHeading>
			<p class="text-sm text-muted">
				Engine settings, used when the pool is empty or every provider in it fails. Password
				resets and sign-in links use this when no provider can send, so an instance with no pool
				still delivers them. The engine reads these at boot, so a change takes effect at
				the next restart. A password is write-only: it is never sent back to this page, and
				saving a new one replaces the stored value.
			</p>

			<Card>
				<div class="divide-y divide-line">
					{#each mail as setting (setting.key)}
						<div class="py-3 first:pt-0 last:pb-0">
							<div class="flex flex-wrap items-baseline justify-between gap-2">
								<code class="font-mono text-sm text-fg">{setting.key}</code>
								{#if setting.source === 'env'}
									<span class="inline-flex items-center gap-1 text-xs text-faint">
										<Terminal size={ICON.xs} aria-hidden="true" /> environment
									</span>
								{/if}
							</div>

							{#if setting.editable}
								<div class="mt-2">
									<SettingRow
										id="set-{setting.key}"
										name={setting.key}
										label={settingLabel(setting.key)}
										value={setting.value}
										secret={setting.secret}
										action="?/saveSetting"
										saved="Saved. It applies at the next engine restart."
										result={settingResult}
									/>
								</div>
							{:else}
								<div class="mt-2 flex flex-wrap items-center gap-2">
									<Lock size={ICON.xs} class="text-faint" aria-hidden="true" />
									{#if setting.secret}
										<span class="flex-1 rounded-lg bg-surface-2 px-3 py-1.5 text-sm text-faint">
											Stored, not shown.
										</span>
									{:else}
										<code
											class="flex-1 rounded-lg bg-surface-2 px-3 py-1.5 font-mono text-sm text-muted"
										>
											{setting.value ?? ''}
										</code>
									{/if}
								</div>
								<p class="mt-1 text-xs text-faint">{settingHint(setting)}</p>
							{/if}
						</div>
					{/each}
				</div>
			</Card>
		</section>
	{/if}
</PageShell>

<Drawer bind:open title={editing ? `Edit ${editing.name}` : 'New provider'}>
	{#if pageRefusal}
		<div class="mb-4"><RefusalNotice refusal={pageRefusal} /></div>
	{/if}
	<form
		method="POST"
		action={editing ? '?/update' : '?/create'}
		id="provider-form"
		use:enhance={submit.enhance}
		class="flex flex-col gap-4"
	>
		{#if editing}
			<input type="hidden" name="id" value={editing.id} />
			<input type="hidden" name="stored_transport" value={editing.transport} />
		{/if}
		<Input id="ep-name" name="name" label="Name" hint="A label for the pool, such as Primary or Marketing." bind:value={providerName} required />
		<Select
			id="ep-transport"
			name="transport"
			label="Transport"
			options={TRANSPORT_OPTIONS}
			value={transport}
			hint="SMTP talks to a mail server; a provider API sends over HTTPS with a key."
			onvaluechange={(v) => (transport = v)}
		/>
		<Input id="ep-from" name="from_addr" label="From address" placeholder="noreply@example.com" value={editing?.from_addr ?? ''} required />

		{#if isApi}
			<div class="flex flex-col gap-3 rounded-md border border-line p-3" data-testid="api-section">
				<SectionHeading level={3} variant="eyebrow">Provider API</SectionHeading>
				<PasswordInput id="ep-api-key" name="api_key" label="API key" hint={keyHint} required={!keyKept} autocomplete="off" />
				<Input
					id="ep-api-base-url"
					name="api_base_url"
					label="API base URL"
					placeholder="https://api.example.com"
					hint="Where the send request goes. The path below is appended."
					bind:value={apiBaseUrl}
					required
				/>
				<Select id="ep-api-method" name="api_method" label="Method" options={METHOD_OPTIONS} value={apiMethod} hint="The verb of the send request; POST for nearly every provider." onvaluechange={(v) => (apiMethod = v)} />
				<Input id="ep-api-path" name="api_path" label="Path" placeholder="/v3/messages" hint="Appended to the base URL. Starts with / and carries no query string." bind:value={apiPath} />
				<fieldset class="flex flex-col gap-2">
					<legend class="text-xs font-semibold uppercase tracking-wide text-faint">Headers</legend>
					<p class="text-xs text-muted">
						Write <span class="font-mono">{'{{api_key}}'}</span> where the key goes, or <span class="font-mono">{'{{basic:<user>}}'}</span> for a basic-auth header built from that user and the key. Both are spliced in at send time and never stored in the header.
					</p>
					{#each apiHeaders as h, i (i)}
						<div class="flex items-end gap-2">
							<Input id="ep-header-key-{i}" name="api_header_key" label="Header" bind:value={h.key} class="min-w-0 flex-1" />
							<Input id="ep-header-value-{i}" name="api_header_value" label="Value" bind:value={h.value} class="min-w-0 flex-1" />
							<Button variant="ghost" size="sm" aria-label="Remove header {h.key || i + 1}" onclick={() => (apiHeaders = apiHeaders.filter((_, j) => j !== i))}>
								<Trash2 size={ICON.sm} class="text-danger" />
							</Button>
						</div>
					{/each}
					<div>
						<Button variant="secondary" size="sm" onclick={() => (apiHeaders = [...apiHeaders, { key: '', value: '' }])}>
							<Plus size={ICON.sm} />
							Add header
						</Button>
					</div>
				</fieldset>
				<Textarea id="ep-api-body" name="api_body" label="Body template" rows={8}  hint={placeholderHint} bind:value={apiBody} mono />
				<Input id="ep-api-message-id-path" name="api_message_id_path" label="Message id path (optional)" placeholder="data.id" hint="A dotted path into the response that names the provider's message id." bind:value={apiMessageIdPath} />
			</div>

			<div class="flex flex-col gap-3 rounded-md border border-line p-3" data-testid="webhook-section">
				<SectionHeading level={3} variant="eyebrow">Delivery webhook</SectionHeading>
				<p class="text-xs text-muted">
					{#if editing && editing.transport === 'api'}
						Point the provider at <span class="font-mono">{webhookPath(editing.id)}</span> on this instance, with the secret as its token in <span class="font-mono">X-Webhook-Token</span> or <span class="font-mono">?token=</span>.
					{:else}
						Once the row exists, the list shows the path on this instance to point the provider at. The secret is its token in <span class="font-mono">X-Webhook-Token</span> or <span class="font-mono">?token=</span>.
					{/if}
					These paths read the event out of what it posts.
				</p>
				<PasswordInput id="ep-webhook-secret" name="webhook_secret" label="Webhook secret" hint={keyKept ? keptHint : 'Encrypted at rest.'} autocomplete="off" />
				<Input id="ep-webhook-event-path" name="api_webhook_event_path" label="Event path" placeholder="event" bind:value={webhookEventPath} />
				<Input id="ep-webhook-recipient-path" name="api_webhook_recipient_path" label="Recipient path" placeholder="recipient" bind:value={webhookRecipientPath} />
				<Input id="ep-webhook-message-id-path" name="api_webhook_message_id_path" label="Message id path" placeholder="message.id" bind:value={webhookMessageIdPath} />
				<Input id="ep-webhook-reason-path" name="api_webhook_reason_path" label="Reason path (optional)" placeholder="delivery-status.message" hint="Where the provider's own text for a bounce sits. The classifier reads it to name a category." bind:value={webhookReasonPath} />
				<fieldset class="flex flex-col gap-2">
					<legend class="text-xs font-semibold uppercase tracking-wide text-faint">Event map</legend>
					<p class="text-xs text-muted">The provider's event value on the left, what it means on the right.</p>
					{#each eventMap as m, i (i)}
						<div class="flex items-end gap-2">
							<Input id="ep-event-key-{i}" name="event_map_key" label="Provider value" bind:value={m.key} class="min-w-0 flex-1" />
							<div class="min-w-0 flex-1">
								<Select id="ep-event-value-{i}" name="event_map_value" label="Means" options={EVENT_OPTIONS} value={m.value || 'delivered'} onvaluechange={(v) => (m.value = v)} />
							</div>
							<Button variant="ghost" size="sm" aria-label="Remove mapping {m.key || i + 1}" onclick={() => (eventMap = eventMap.filter((_, j) => j !== i))}>
								<Trash2 size={ICON.sm} class="text-danger" />
							</Button>
						</div>
					{/each}
					<div>
						<Button variant="secondary" size="sm" onclick={() => (eventMap = [...eventMap, { key: '', value: 'delivered' }])}>
							<Plus size={ICON.sm} />
							Add mapping
						</Button>
					</div>
				</fieldset>
			</div>
		{:else}
			<div class="flex flex-col gap-3 rounded-md border border-line p-3" data-testid="smtp-section">
				<SectionHeading level={3} variant="eyebrow">SMTP server</SectionHeading>
				<Input id="ep-host" name="host" label="Host" placeholder="smtp.example.com" bind:value={host} required />
				<Input id="ep-port" name="port" label="Port" inputmode="numeric" bind:value={port} />
				<Input id="ep-username" name="username" label="Username" bind:value={username} autocomplete="off" />
				<PasswordInput id="ep-password" name="password" label="Password" hint={passwordKept ? keptHint : 'Encrypted at rest.'} autocomplete="off" />
				<div>
					<input type="hidden" name="use_tls" value={useTLS ? 'true' : 'false'} />
					<Toggle id="ep-use-tls" label="TLS" hint="STARTTLS on the connection." bind:checked={useTLS} />
				</div>
			</div>
		{/if}

		<div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
			<Input id="ep-priority" name="priority" label="Priority" inputmode="numeric" hint="0 sends first." value={String(editing?.priority ?? 0)} />
			<Input id="ep-max-per-hour" name="max_per_hour" label="Max per hour" inputmode="numeric" hint="0 is unlimited." value={String(editing?.max_per_hour ?? 0)} />
			<Select id="ep-status" name="status" label="Status" options={STATUS_OPTIONS} value={status} onvaluechange={(v) => (status = v)} />
		</div>
	</form>
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (open = false)}>Cancel</Button>
		<Button variant="primary" type="submit" form="provider-form" loading={submit.pending}>{editing ? 'Save' : 'Create'}</Button>
	{/snippet}
</Drawer>

<form method="POST" action="?/delete" use:enhance bind:this={deleteForm} class="hidden">
	<input type="hidden" name="id" value={deleteId} />
</form>
