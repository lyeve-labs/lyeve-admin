<script lang="ts">
	import PageTitle from '$lib/components/PageTitle.svelte';
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
		SectionHeading,
		Select,
		Table,
		Textarea,
		Toggle,
		confirm,
	} from '@lyeve-labs/ui-kit';
	import { Database, MessageSquare, Pencil, PlugZap, Plus, Trash2 } from '@lucide/svelte';
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { flowBack } from '$lib/flow/back';
	import { untrack } from 'svelte';
	import type { ActionData, PageData } from './$types';
	import type { Datasource, DatasourceKind } from '$lib/api/flows';
	import NotEnabled from '$lib/components/NotEnabled.svelte';
	import { useInstance } from '$lib/instance.svelte';
	import { submitter } from '$lib/forms.svelte';
	import { formatDuration } from '$lib/flow/time';
	import { AUTH_TYPES, EMPTY_AUTH, SSL_MODES, authFieldsOf, isAuthType, isSqlKind, secretKept, sslModeFor, type AuthFields } from '$lib/flow/datasources';
	import { relativeTime, formatDateTime } from '$lib/format';
	import { ICON } from '$lib/icon';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const submit = submitter(() => (open = false));

	// The shell shows why the page is unavailable while the flow plugin does
	// not run. A plugin that runs and refuses its routes is said here.
	const enabled = $derived(!data.locked);
	// The plugin says whether this instance may use datasources. Without that
	// the list is empty by design and a create is refused, so the button is
	// disabled and the page says the feature is not enabled rather than that
	// there are none yet.
	const available = $derived(data.available !== false);
	const instance = useInstance();
	const enableLink = $derived(instance.upgradeLink());

	const KIND_OPTIONS = [
		{ value: 'postgres', label: 'Postgres' },
		{ value: 'mysql', label: 'MySQL' },
		{ value: 'mssql', label: 'SQL Server' },
		{ value: 'http', label: 'HTTP base' },
		{ value: 'google_sheets', label: 'Google Sheets' },
	];

	const DEFAULT_PORT: Record<string, string> = { postgres: '5432', mysql: '3306', mssql: '1433' };

	type HeaderRow = { key: string; value: string; secret: boolean };

	let open = $state(false);
	let editing = $state<Datasource | null>(null);
	let kind = $state<string | null>('postgres');
	let host = $state('');
	let port = $state('');
	let database = $state('');
	let user = $state('');
	let ssl = $state<string | null>('require');
	let baseUrl = $state('');
	let chatId = $state('');
	let headers = $state<HeaderRow[]>([]);
	let apiBase = $state('');
	let auth = $state<AuthFields>({ ...EMPTY_AUTH });
	let allowWrites = $state(false);
	let allowPrivate = $state(false);

	function str(v: unknown): string {
		return typeof v === 'string' || typeof v === 'number' ? String(v) : '';
	}

	function openCreate() {
		editing = null;
		kind = 'postgres';
		host = '';
		port = '5432';
		database = '';
		user = '';
		ssl = sslModeFor('postgres', undefined);
		baseUrl = '';
		chatId = '';
		headers = [];
		apiBase = '';
		auth = { ...EMPTY_AUTH };
		allowWrites = false;
		allowPrivate = false;
		open = true;
	}

	function openEdit(ds: Datasource) {
		editing = ds;
		kind = ds.kind;
		host = str(ds.config.host);
		port = str(ds.config.port) || DEFAULT_PORT[ds.kind] || '';
		database = str(ds.config.database);
		user = str(ds.config.user);
		ssl = isSqlKind(ds.kind) ? sslModeFor(ds.kind, ds.config.ssl) : null;
		baseUrl = str(ds.config.base_url);
		chatId = str(ds.config.chat_id);
		const h = ds.config.headers;
		headers =
			h && typeof h === 'object'
				? Object.entries(h as Record<string, unknown>).map(([key, value]) => ({
						key,
						value: str(value),
						// A masked value is a secret the engine will not return. The
						// row stays secret and blank means keep it.
						secret: str(value) === '***',
				  }))
				: [];
		apiBase = str(ds.config.api_base);
		auth = authFieldsOf(ds.config);
		allowWrites = ds.allow_writes;
		allowPrivate = ds.allow_private;
		open = true;
	}

	function onKindChange(next: string) {
		kind = next;
		if (DEFAULT_PORT[next] && !port) port = DEFAULT_PORT[next];
		// Each driver spells its TLS modes its own way, so a kind change resets
		// the mode to that driver's default rather than carrying a word over.
		if (isSqlKind(next)) ssl = sslModeFor(next, undefined);
	}

	// The stored scheme decides whether a blank secret means "keep it": only
	// the scheme the engine holds a secret for can be left blank. A new
	// datasource, or a scheme change, needs the secret typed.
	const storedAuth = $derived(editing ? { has_secret: editing.has_secret, type: authFieldsOf(editing.config).type } : null);
	const keepSecret = $derived(secretKept(storedAuth, auth.type));
	const schemeChanged = $derived(storedAuth !== null && storedAuth.type !== auth.type && auth.type !== 'none');
	const secretHint = $derived(
		keepSecret
			? 'Stored and never shown. Leave blank to keep it.'
			: schemeChanged
				? 'The scheme changed, so its secret is needed.'
				: 'Encrypted at rest.'
	);

	const sqlKind = $derived(isSqlKind(kind) ? kind : null);
	const isSql = $derived(sqlKind !== null);
	const sslOptions = $derived(sqlKind ? SSL_MODES[sqlKind] : []);

	// Delete goes through the kit's confirm dialog, then a hidden form, so the
	// row's button never posts on its own and the action stays a form action.
	let deleteId = $state('');
	let deleteForm = $state<HTMLFormElement>();

	async function askDelete(ds: Datasource) {
		const ok = await confirm(
			'Delete datasource',
			`Delete ${ds.name}? A flow that names it will fail at that node until you create it again.`,
			{ confirmLabel: 'Delete' }
		);
		if (!ok) return;
		deleteId = ds.id;
		await Promise.resolve();
		deleteForm?.requestSubmit();
	}

	// Keyed by row so a second test does not erase the first row's answer. The
	// map is read untracked: a tracked read of what the effect writes re-runs it
	// forever.
	let testResults = $state<Record<string, { ok: boolean; latency_ms: number; error: string }>>({});
	$effect(() => {
		if (form && 'testResult' in form && form.testResult) {
			const r = form.testResult;
			testResults = { ...untrack(() => testResults), [r.id]: r };
		}
	});

	function kindLabel(k: DatasourceKind): string {
		return KIND_OPTIONS.find((o) => o.value === k)?.label ?? k;
	}
</script>

<PageTitle title="Datasources - Flows" />

{#if enabled}
	<PageShell
		title="Datasources"
		description="Stored, encrypted connections a flow refers to by name: an external database, an HTTP base with headers, or a Google service account."
		width="wide"
		back={flowBack(page.url)}
	>
		{#snippet actions()}
			<Badge tone="violet" size="sm">Beta</Badge>
			<!-- Stored rows outlive the feature and fill the body, so the header
			     says the feature is not enabled. An empty page says so in its body. -->
			{#if !available && data.datasources.length > 0}
				<NotEnabled compact title="Datasources" />
			{/if}
			<Button variant="primary" size="sm" onclick={openCreate} disabled={!available} title={available ? undefined : 'Not enabled on this instance'}>
				<Plus size={ICON.sm} />
				New datasource
			</Button>
		{/snippet}

		<!-- Chat lives here because a chat channel is a datasource and nothing
		     else: there is no chat setting to store, only the webhook or bot
		     API this page already holds. -->
		<Card>
			<div class="flex items-start gap-4">
				<span
					class="mt-0.5 flex h-9 w-9 items-center justify-center rounded-lg bg-brand/15 text-brand"
					aria-hidden="true"
				>
					<MessageSquare size={ICON.lg} />
				</span>
				<div class="min-w-0 flex-1">
					<p class="text-sm text-muted">
						Slack, Discord and Telegram are reached from a flow. The
						<code class="font-mono text-xs">chat.notify</code> node posts a message shaped for
						the service, through an HTTP datasource whose base URL is the incoming webhook, or
						the bot API with the chat id on the datasource. The
						<code class="font-mono text-xs">chat-notify</code> template starts from a created
						record and is the shortest way to a first message.
					</p>
					<p class="mt-2 text-xs text-faint">
						<code class="font-mono">EVENT_BUS</code> names the engine's message bus and never a
						chat service: <code class="font-mono">discord</code>,
						<code class="font-mono">slack</code> and <code class="font-mono">telegram</code> there
						stop the engine from starting.
					</p>
				</div>
			</div>
		</Card>

		{#if data.loadError}
			<Alert tone="danger" title="Datasources could not be loaded">
				{#snippet children()}{data.loadError} Reload once the engine answers again.{/snippet}
			</Alert>
		{/if}

		{#if form && 'refused' in form && form.refused}
			<Alert tone="warn" title="Not enabled on this instance">
				{#snippet children()}
					{'error' in form ? form.error : ''}
					{#if enableLink}
						<a class="ml-1 underline" href={enableLink.href}>{enableLink.label ?? 'How to enable it'}</a>
					{/if}
				{/snippet}
			</Alert>
		{:else if form && 'error' in form && form.error}
			<Alert tone="danger">
				{#snippet children()}{form.error}{/snippet}
			</Alert>
		{/if}

		{#if data.loadError}
			<!-- Nothing: the empty state would say there are none. -->
		{:else if !available && data.datasources.length === 0}
			<NotEnabled title="Datasources" description="A flow that uses one is refused when it is saved." />
		{:else if data.datasources.length === 0}
			<EmptyState
				title="No datasources yet"
				description="A db.query, http.request or sheets node names one of these."
			>
				{#snippet iconSnippet()}<Database size={ICON.lg} />{/snippet}
				{#snippet action()}
					<Button variant="secondary" onclick={openCreate}>
						<Plus size={ICON.sm} />
						New datasource
					</Button>
				{/snippet}
			</EmptyState>
		{:else}
			<Table label="Datasources">
				<thead>
					<tr>
						<th scope="col">Name</th>
						<th scope="col">Kind</th>
						<th scope="col">Secret</th>
						<th scope="col">Writes</th>
						<th scope="col">Private ranges</th>
						<th scope="col">Connection</th>
						<th scope="col">Updated</th>
						<th scope="col">Actions</th>
					</tr>
				</thead>
				<tbody>
					{#each data.datasources as ds (ds.id)}
						<tr>
							<td data-cell="nowrap" class="font-mono text-sm text-fg">{ds.name}</td>
							<td data-cell="nowrap" class="text-muted">{kindLabel(ds.kind)}</td>
							<td data-cell="nowrap">
								{#if ds.has_secret}<Badge tone="success" dot>Stored</Badge>{:else}<span class="text-xs text-faint">none</span>{/if}
							</td>
							<td data-cell="nowrap">
								{#if ds.allow_writes}<Badge tone="warn" size="sm">allowed</Badge>{:else}<span class="text-xs text-faint">read only</span>{/if}
							</td>
							<td data-cell="nowrap">
								{#if ds.allow_private}<Badge tone="warn" size="sm">allowed</Badge>{:else}<span class="text-xs text-faint">refused</span>{/if}
							</td>
							<td data-cell="nowrap">
								{#if testResults[ds.id]}
									{@const r = testResults[ds.id]}
									<span class="flex items-center gap-2">
										<Badge tone={r.ok ? 'success' : 'danger'} size="sm">{r.ok ? 'connected' : 'failed'}</Badge>
										<span class="text-xs {r.ok ? 'text-muted' : 'text-danger'}">{r.ok ? formatDuration(r.latency_ms) : r.error || 'Connection failed'}</span>
									</span>
								{:else}
									<span class="text-xs text-faint">not tested</span>
								{/if}
							</td>
							<td data-cell="nowrap" class="text-xs text-muted" title={formatDateTime(ds.updated_at)}>{relativeTime(ds.updated_at)}</td>
							<td>
								<div class="flex items-center gap-2">
									<form method="POST" action="?/test" use:enhance>
										<input type="hidden" name="id" value={ds.id} />
										<Button variant="ghost" size="sm" type="submit" title="Test connection" aria-label="Test {ds.name}">
											<PlugZap size={ICON.sm} />
										</Button>
									</form>
									<Button variant="ghost" size="sm" onclick={() => openEdit(ds)} title="Edit" aria-label="Edit {ds.name}">
										<Pencil size={ICON.sm} />
									</Button>
									<Button variant="ghost" size="sm" onclick={() => askDelete(ds)} title="Delete" aria-label="Delete {ds.name}">
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

	<Drawer bind:open title={editing ? `Edit ${editing.name}` : 'New datasource'}>
		<form
			method="POST"
			action={editing ? '?/update' : '?/create'}
			id="datasource-form"
			use:enhance={submit.enhance}
			class="flex flex-col gap-4"
		>
			{#if editing}<input type="hidden" name="id" value={editing.id} />{/if}
			<Input id="ds-name" name="name" label="Name" hint="How a node refers to it." value={editing?.name ?? ''} required />
			<Select
				id="ds-kind"
				name="kind"
				label="Kind"
				options={KIND_OPTIONS}
				value={kind}
				disabled={!!editing}
				onvaluechange={onKindChange}
			/>
			{#if editing}<input type="hidden" name="kind" value={kind} />{/if}

			{#if isSql}
				<Input id="ds-host" name="host" label="Host" bind:value={host} required />
				<Input id="ds-port" name="port" label="Port" inputmode="numeric" bind:value={port} />
				<Input id="ds-database" name="database" label="Database" bind:value={database} required />
				<Input id="ds-user" name="user" label="User" bind:value={user} />
				<PasswordInput
					id="ds-password"
					name="password"
					label="Password"
					hint={editing?.has_secret ? 'Stored and never shown. Leave blank to keep it.' : 'Encrypted at rest.'}
				/>
				<Select
					id="ds-ssl"
					name="ssl"
					label="TLS"
					options={sslOptions}
					bind:value={ssl}
					hint="What the driver is told about the connection's encryption."
				/>
			{:else if kind === 'http'}
				<Input id="ds-base-url" name="base_url" label="Base URL" placeholder="https://api.example.com" bind:value={baseUrl} required />
				<Input
					id="ds-chat-id"
					name="chat_id"
					label="Chat id (optional)"
					placeholder="@channel or a numeric id"
					hint="For a Telegram bot API base: the chat a chat.notify node posts to unless the node names one."
					bind:value={chatId}
				/>
				<div class="flex flex-col gap-3 rounded-md border border-line p-3" data-testid="auth-section">
					<SectionHeading level={3} variant="eyebrow">Authentication</SectionHeading>
					<Select
						id="ds-auth-type"
						name="auth_type"
						label="Type"
						options={AUTH_TYPES}
						value={auth.type}
						hint="Sent with every request of an http.request node; an explicit Authorization header on the node wins."
						onvaluechange={(v) => {
							if (isAuthType(v)) auth = { ...auth, type: v };
						}}
					/>
					{#if auth.type === 'bearer'}
						<PasswordInput id="ds-auth-token" name="auth_token" label="Token" hint={secretHint} required={!keepSecret} autocomplete="off" />
					{:else if auth.type === 'basic'}
						<Input id="ds-auth-user" name="auth_user" label="User" bind:value={auth.user} required />
						<PasswordInput id="ds-auth-password" name="auth_password" label="Password" hint={secretHint} required={!keepSecret} autocomplete="off" />
					{:else if auth.type === 'oauth2_client_credentials'}
						<Input id="ds-auth-token-url" name="auth_token_url" label="Token URL" placeholder="https://auth.example.com/oauth/token" bind:value={auth.token_url} required />
						<Input id="ds-auth-client-id" name="auth_client_id" label="Client id" bind:value={auth.client_id} required />
						<PasswordInput id="ds-auth-client-secret" name="auth_client_secret" label="Client secret" hint={secretHint} required={!keepSecret} autocomplete="off" />
						<Input id="ds-auth-scopes" name="auth_scopes" label="Scopes" placeholder="read write" hint="Space separated." bind:value={auth.scopes} />
						<Input id="ds-auth-audience" name="auth_audience" label="Audience" hint="Optional. Sent as audience in the token request." bind:value={auth.audience} />
					{:else}
						<p class="text-xs text-muted">No credential beyond the headers below.</p>
					{/if}
				</div>
				<fieldset class="flex flex-col gap-2">
					<legend class="text-xs font-semibold uppercase tracking-wide text-faint">Headers</legend>
					{#each headers as h, i (i)}
						<div class="flex items-end gap-2">
							<Input id="ds-header-key-{i}" name="header_key" label="Header" bind:value={h.key} class="min-w-0 flex-1" />
							{#if h.secret}
								<PasswordInput
									id="ds-header-value-{i}"
									name="header_value"
									label="Value"
									hint={h.value === '***' ? 'Stored. Blank keeps it.' : undefined}
									class="min-w-0 flex-1"
								/>
							{:else}
								<Input id="ds-header-value-{i}" name="header_value" label="Value" bind:value={h.value} class="min-w-0 flex-1" />
							{/if}
							<input type="hidden" name="header_secret" value={h.secret ? 'true' : 'false'} />
							<Toggle id="ds-header-secret-{i}" label="Secret" size="sm" bind:checked={h.secret} />
							<Button variant="ghost" size="sm" aria-label="Remove header {h.key || i + 1}" onclick={() => (headers = headers.filter((_, j) => j !== i))}>
								<Trash2 size={ICON.sm} class="text-danger" />
							</Button>
						</div>
					{/each}
					<div>
						<Button variant="secondary" size="sm" onclick={() => (headers = [...headers, { key: '', value: '', secret: false }])}>
							<Plus size={ICON.sm} />
							Add header
						</Button>
					</div>
				</fieldset>
			{:else}
				<Textarea
					id="ds-sa"
					name="service_account_json"
					label="Service account JSON"
					rows={8}
					hint={editing?.has_secret ? 'Stored and never shown. Leave blank to keep it.' : 'The key file Google issued for the service account. Encrypted at rest.'}
					mono
				/>
				<Input id="ds-api-base" name="api_base" label="API base (optional)" placeholder="https://sheets.googleapis.com" bind:value={apiBase} />
			{/if}

			<div>
				<input type="hidden" name="allow_writes" value={allowWrites ? 'true' : 'false'} />
				<Toggle id="ds-allow-writes" label="Allow writes" hint="A db.query node may commit when this is on." bind:checked={allowWrites} />
			</div>
			<div>
				<input type="hidden" name="allow_private" value={allowPrivate ? 'true' : 'false'} />
				<Toggle id="ds-allow-private" label="Allow private addresses" hint="Off refuses hosts that resolve to a private range." bind:checked={allowPrivate} />
			</div>
		</form>
		{#snippet footer()}
			<Button variant="secondary" onclick={() => (open = false)}>Cancel</Button>
			<Button variant="primary" type="submit" form="datasource-form" loading={submit.pending}>{editing ? 'Save' : 'Create'}</Button>
		{/snippet}
	</Drawer>

	<form method="POST" action="?/delete" use:enhance bind:this={deleteForm} class="hidden">
		<input type="hidden" name="id" value={deleteId} />
	</form>
{:else}
	<PageShell title="Flows" width="wide">
		<NotEnabled title="Flows" description="Datasources belong to the flow plugin, and the engine refused its routes." />
	</PageShell>
{/if}
