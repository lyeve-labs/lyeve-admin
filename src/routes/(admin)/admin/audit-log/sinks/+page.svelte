<script lang="ts">
	import PageTitle from '$lib/components/PageTitle.svelte';
	import {
		Alert,
		Badge,
		Button,
		Card,
		Checkbox,
		CopyField,
		Drawer,
		EmptyState,
		Input,
		Modal,
		PageShell,
		PasswordInput,
		Select,
		Toggle,
		confirm as confirmDialog,
	} from '@lyeve-labs/ui-kit';
	import { enhance } from '$app/forms';
	import { Pencil, Plus, Radio, Send, Trash2 } from '@lucide/svelte';
	import type { ActionData, PageData } from './$types';
	import AuditTabs from '$lib/components/AuditTabs.svelte';
	import FormErrors from '$lib/components/FormErrors.svelte';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import { fieldErrors, submitter } from '$lib/forms.svelte';
	import { formRefusal } from '$lib/api/refusal';
	import {
		SINK_KINDS,
		SINK_KIND_LABELS,
		SINK_SECRET_LABELS,
		lagText,
		sinkTone,
		type AuditSink,
		type SinkKind,
	} from '$lib/api/audit-sinks';
	import { formatDateTime } from '$lib/format';
	import { ICON } from '$lib/icon';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const errors = $derived(fieldErrors(form));
	const formError = $derived(form && 'error' in form ? String(form.error) : undefined);
	const refused = $derived(formRefusal(form));

	// One drawer for both writes: a null target is a new destination.
	let open = $state(false);
	let editing = $state<AuditSink | null>(null);
	let name = $state('');
	let kind = $state<SinkKind>('https');
	let url = $state('');
	let secret = $state('');
	let splunkIndex = $state('');
	let datadogService = $state('');
	let datadogTags = $state('');
	let enabled = $state(true);
	let backfill = $state(false);
	const submit = submitter(() => (open = false));

	const KIND_OPTIONS = SINK_KINDS.map((k) => ({ value: k, label: SINK_KIND_LABELS[k] }));
	const URL_HINTS: Record<SinkKind, string> = {
		https: 'Receives JSON lines, signed with HMAC-SHA256 over the timestamp and the body.',
		splunk: 'The collector URL, ending in /services/collector/event.',
		datadog: 'The logs intake of your Datadog site.',
	};

	function openCreate() {
		editing = null;
		name = '';
		kind = 'https';
		url = '';
		secret = '';
		splunkIndex = '';
		datadogService = '';
		datadogTags = '';
		enabled = true;
		backfill = false;
		open = true;
	}

	function openEdit(s: AuditSink) {
		editing = s;
		name = s.name;
		kind = s.kind;
		url = s.url;
		secret = '';
		splunkIndex = s.splunk_index ?? '';
		datadogService = s.datadog_service ?? '';
		datadogTags = s.datadog_tags ?? '';
		enabled = s.enabled;
		open = true;
	}

	const secretHint = $derived(
		editing
			? 'Leave blank to keep the current one.'
			: kind === 'https'
				? 'Leave blank and one is generated and shown once.'
				: 'Required.',
	);

	// A secret the plugin generated is shown once, right after the create.
	let reveal = $state<{ name: string; secret: string } | null>(null);
	$effect(() => {
		if (form && 'created' in form && typeof form.secret === 'string' && form.secret) {
			reveal = { name: String(form.created), secret: form.secret };
		}
	});

	const success = $derived.by(() => {
		if (!form) return '';
		if ('created' in form) return `${form.created} is streaming the audit log.`;
		if ('saved' in form) return `${form.saved} saved.`;
		if ('deleted' in form) return 'Destination deleted. It receives nothing more.';
		return '';
	});
	const tested = $derived(
		form && 'tested' in form ? { id: String(form.tested), delivered: !!form.delivered, error: String(form.testError ?? '') } : null,
	);

	let targetId = $state('');
	let deleteForm = $state<HTMLFormElement>();
	async function askDelete(s: AuditSink) {
		const ok = await confirmDialog(`Delete ${s.name}?`, 'The destination stops receiving the audit log. Entries already sent stay where they are.', {
			confirmLabel: 'Delete',
		});
		if (!ok) return;
		targetId = s.id;
		await Promise.resolve();
		deleteForm?.requestSubmit();
	}
</script>

<PageTitle title="Audit streaming" />

<PageShell
	title="Audit log"
	description="Stream every audit entry to a security tool outside the instance, delivered at least once and in order."
	width="wide"
>
	{#snippet actions()}
		{#if data.gate.state === 'ok'}
			<Button variant="primary" size="sm" onclick={openCreate}>
				<Plus size={ICON.sm} /> New destination
			</Button>
		{/if}
	{/snippet}

	<AuditTabs active="sinks" sinks={data.gate.state === 'ok' ? data.sinks.length : undefined} />

	{#if data.gate.state !== 'ok'}
		<GateNotice gate={data.gate} title="Audit streaming" absent="This build does not stream the audit log anywhere." />
	{:else}
		<div class="flex flex-col gap-4">
			{#if !open}
				<FormErrors message={formError} fields={errors} {refused} />
			{/if}
			{#if success}
				<Alert tone="success" autoDismiss>{success}</Alert>
			{/if}

			{#if data.sinks.length === 0}
				<EmptyState
					title="Nothing receives the audit log"
					description="Add an HTTPS endpoint, a Splunk collector or Datadog, and every entry is sent there as it is written."
				>
					{#snippet iconSnippet()}<Radio size={ICON.lg} />{/snippet}
					{#snippet action()}
						<Button variant="secondary" onclick={openCreate}><Plus size={ICON.sm} /> New destination</Button>
					{/snippet}
				</EmptyState>
			{:else}
				{#each data.sinks as s (s.id)}
					<Card>
						<div class="flex flex-wrap items-start gap-4">
							<div class="min-w-0 flex-1">
								<div class="flex flex-wrap items-center gap-2">
									<span class="font-semibold text-fg">{s.name}</span>
									<Badge tone="neutral">{SINK_KIND_LABELS[s.kind] ?? s.kind}</Badge>
									<Badge tone={sinkTone(s)} dot>{s.enabled ? lagText(s) : 'Paused'}</Badge>
								</div>
								<p class="mt-1 truncate font-mono text-xs text-muted">{s.url}</p>
								<div class="mt-1 flex flex-wrap gap-4 text-xs text-faint">
									<span>Last delivered: {s.last_shipped_at ? formatDateTime(s.last_shipped_at) : 'never'}</span>
									{#if s.consecutive_failures > 0}
										<span class="text-danger">{s.consecutive_failures} failed {s.consecutive_failures === 1 ? 'attempt' : 'attempts'} in a row</span>
									{/if}
									{#if s.next_attempt_at && s.consecutive_failures > 0}
										<span>Next try {formatDateTime(s.next_attempt_at)}</span>
									{/if}
								</div>
								{#if s.last_error}
									<p class="mt-2 text-xs text-danger" data-testid="sink-error">
										{s.last_error}{s.last_error_at ? ` (${formatDateTime(s.last_error_at)})` : ''}
									</p>
								{/if}
								{#if tested && tested.id === s.id}
									<div class="mt-2">
										<Alert tone={tested.delivered ? 'success' : 'danger'} autoDismiss={tested.delivered}>
											{tested.delivered ? 'The test entry was delivered.' : `The test entry was not delivered: ${tested.error}`}
										</Alert>
									</div>
								{/if}
							</div>
							<div class="flex shrink-0 items-center gap-1">
								<form method="POST" action="?/test" use:enhance>
									<input type="hidden" name="id" value={s.id} />
									<Button variant="ghost" size="sm" type="submit"><Send size={ICON.sm} /> Send a test</Button>
								</form>
								<Button variant="ghost" size="sm" onclick={() => openEdit(s)} aria-label="Edit {s.name}">
									<Pencil size={ICON.sm} />
								</Button>
								<Button variant="ghost" size="sm" onclick={() => askDelete(s)} aria-label="Delete {s.name}">
									<Trash2 size={ICON.sm} class="text-danger" />
								</Button>
							</div>
						</div>
					</Card>
				{/each}
			{/if}
		</div>
	{/if}
</PageShell>

<Drawer bind:open title={editing ? `Edit ${editing.name}` : 'New destination'}>
	<form method="POST" action={editing ? '?/update' : '?/create'} id="sink-form" use:enhance={submit.enhance} class="flex flex-col gap-4">
		<FormErrors message={formError} fields={errors} {refused} />
		{#if editing}<input type="hidden" name="id" value={editing.id} />{/if}
		<Input id="sink-name" name="name" label="Name" required bind:value={name} error={errors.name} placeholder="Security team SIEM" />
		{#if editing}
			<Input id="sink-kind" label="Destination" value={SINK_KIND_LABELS[kind]} disabled hint="A destination keeps its kind. Create a new one to change it." />
		{:else}
			<Select
				id="sink-kind"
				name="kind"
				label="Destination"
				options={KIND_OPTIONS}
				value={kind}
				onvaluechange={(v) => (kind = v as SinkKind)}
			/>
		{/if}
		<Input id="sink-url" name="url" label="URL" type="url" required bind:value={url} error={errors.url} hint={URL_HINTS[kind]} />
		<PasswordInput id="sink-secret" name="secret" label={SINK_SECRET_LABELS[kind]} hint={secretHint} bind:value={secret} error={errors.secret} />
		{#if kind === 'splunk'}
			<Input id="sink-index" name="splunk_index" label="Index" bind:value={splunkIndex} hint="Leave blank for the collector's default index." />
		{/if}
		{#if kind === 'datadog'}
			<Input id="sink-service" name="datadog_service" label="Service" bind:value={datadogService} />
			<Input id="sink-tags" name="datadog_tags" label="Tags" bind:value={datadogTags} placeholder="env:prod,team:security" />
		{/if}
		<input type="hidden" name="enabled" value={enabled ? 'true' : 'false'} />
		<Toggle id="sink-enabled" label="Enabled" bind:checked={enabled} />
		{#if !editing}
			<input type="hidden" name="backfill" value={backfill ? 'true' : 'false'} />
			<Checkbox id="sink-backfill" label="Send the existing log too" hint="Off, the destination receives entries written from now on." bind:checked={backfill} />
		{/if}
	</form>
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (open = false)}>Cancel</Button>
		<Button variant="primary" type="submit" form="sink-form" disabled={!name.trim() || !url.trim()} loading={submit.pending}>
			{editing ? 'Save' : 'Create'}
		</Button>
	{/snippet}
</Drawer>

{#if reveal}
	<Modal open title="Signing secret" onclose={() => (reveal = null)}>
		<div class="flex flex-col gap-3">
			<p class="text-sm text-fg">
				{reveal.name} signs every delivery with this secret. Copy it to the receiver now. It is not shown again.
			</p>
			<CopyField value={reveal.secret} label="Signing secret" mono secret />
		</div>
		{#snippet footer()}
			<Button variant="secondary" onclick={() => (reveal = null)}>Close</Button>
		{/snippet}
	</Modal>
{/if}

<form method="POST" action="?/delete" use:enhance bind:this={deleteForm} class="hidden">
	<input type="hidden" name="id" value={targetId} />
</form>
