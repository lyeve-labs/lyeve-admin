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
		confirm as confirmDialog,
		toast,
	} from '@lyeve-labs/ui-kit';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { Copy, HardDrive, Pencil, Plug, Plus, Trash2 } from '@lucide/svelte';
	import { duplicateRow } from '$lib/duplicate';
	import { submitter } from '$lib/forms.svelte';
	import {
		PROVIDER_FIELDS,
		PROVIDER_LABELS,
		PROVIDER_TYPES,
		activeProvider,
		brokenCredentials,
		isCredential,
		providerLabel,
		providerState,
		providerTone,
		providerValues,
		publiclyReadable,
		targetLabel,
		type ProviderField,
		type ProviderType,
		type StorageProvider,
	} from '$lib/api/storage';
	import type { ActionData, PageData } from './$types';
	import { ICON } from '$lib/icon';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const formError = $derived((form as { error?: string } | null)?.error ?? '');
	const providerError = $derived((form as { providerError?: string } | null)?.providerError ?? '');

	// One drawer for create and edit. A null target is a new provider.
	let drawerOpen = $state(false);
	let editing = $state<StorageProvider | null>(null);
	let kind = $state<ProviderType>('s3');
	let name = $state('');
	let values = $state<Record<string, string>>(providerValues());
	let useSSL = $state(true);
	let pathStyle = $state(false);
	let enabled = $state(true);
	let priority = $state('0');
	let publicUnsigned = $state(false);

	const typeOptions = PROVIDER_TYPES.map((t) => ({ value: t, label: PROVIDER_LABELS[t] ?? t }));
	const fields = $derived(PROVIDER_FIELDS[kind]);

	function openCreate() {
		editing = null;
		kind = 's3';
		name = '';
		values = providerValues();
		useSSL = true;
		pathStyle = false;
		enabled = true;
		priority = '0';
		publicUnsigned = false;
		drawerOpen = true;
	}

	function openEdit(p: StorageProvider) {
		editing = p;
		kind = (PROVIDER_TYPES as readonly string[]).includes(p.provider_type) ? (p.provider_type as ProviderType) : 's3';
		name = p.name;
		values = providerValues({ region: p.region ?? '', bucket: p.bucket ?? '', endpoint: p.endpoint ?? '', cdn_base_url: p.cdn_base_url ?? '' });
		useSSL = p.use_ssl;
		pathStyle = p.path_style;
		enabled = p.enabled;
		priority = String(p.priority);
		publicUnsigned = p.local_public_unsigned;
		drawerOpen = true;
	}

	/**
	 * Copy a provider into the create drawer.
	 *
	 * The credentials do not travel, and could not: they are stored encrypted
	 * and never sent back to this page, so the copy starts with empty boxes
	 * and the operator supplies a key for the bucket they are pointing at.
	 * The copy also arrives disabled, so a provider does not begin receiving
	 * uploads before anyone has checked where it writes.
	 */
	function openDuplicate(source: StorageProvider) {
		const draft = duplicateRow(source as unknown as Record<string, unknown>, {
			taken: data.providers.map((x) => x.name),
		});
		editing = null;
		kind = (PROVIDER_TYPES as readonly string[]).includes(source.provider_type)
			? (source.provider_type as ProviderType)
			: 's3';
		name = String(draft.name ?? source.name);
		values = providerValues({
			region: source.region ?? '',
			bucket: source.bucket ?? '',
			endpoint: source.endpoint ?? '',
			cdn_base_url: source.cdn_base_url ?? '',
		});
		useSSL = source.use_ssl;
		pathStyle = source.path_style;
		enabled = false;
		priority = String(source.priority);
		publicUnsigned = source.local_public_unsigned;
		drawerOpen = true;
	}

	// A credential is never sent back, so on an edit its box is empty and
	// leaving it empty keeps the stored value.
	function hintFor(f: ProviderField): string {
		return editing && isCredential(f) ? `${f.hint} Leave empty to keep the stored one.` : f.hint;
	}

	const save = submitter(() => (drawerOpen = false));
	const active = $derived(activeProvider(data.providers));
	const broken = $derived(brokenCredentials(data.providers));
	const open = $derived(publiclyReadable(data.providers));

	function test(p: StorageProvider): SubmitFunction {
		return () =>
			async ({ result, update }) => {
				await update();
				if (result.type === 'success') toast.success(`${p.name} answered`);
			};
	}

	function remove(p: StorageProvider): SubmitFunction {
		return async ({ cancel }) => {
			const confirmed = await confirmDialog(
				`Delete ${p.name}?`,
				'Objects already stored there stay where they are, and nothing in this instance can read them afterwards.',
				{ confirmLabel: 'Delete' },
			);
			if (!confirmed) {
				cancel();
				return;
			}
			return async ({ result, update }) => {
				await update();
				if (result.type === 'success') toast.success(`Deleted ${p.name}`);
			};
		};
	}
</script>

<PageTitle title="Storage" />

<PageShell
	title="Storage"
	description="Where uploads are written, and which provider is receiving them."
	width="wide"
	back={{ href: '/admin/settings', label: 'Settings' }}
>
	{#snippet actions()}
		{#if data.canConfigure && data.gate.state === 'ok'}
			<Button variant="primary" size="sm" onclick={openCreate}>
				<Plus size={ICON.sm} /> New provider
			</Button>
		{/if}
	{/snippet}

	{#if data.gate.state !== 'ok'}
		<GateNotice
			gate={data.gate}
			title="Storage"
			absent="The storage plugin is not part of this build, so uploads have nowhere to go."
		/>
	{:else}
		{#if formError}
			<Alert tone="danger">{formError}</Alert>
		{/if}

		{#if broken.length > 0}
			<!-- A row whose secrets will not decrypt looks configured and fails
			     every write. The failure surfaces as a media error far from
			     here, so this is the only place it is named. -->
			<Alert tone="danger">
				{broken.length}
				{broken.length === 1 ? 'provider has' : 'providers have'} credentials the engine can no
				longer decrypt. They look configured and fail every upload, and that failure shows up
				as a media error somewhere else entirely.
			</Alert>
		{/if}

		{#if open.length > 0}
			<!-- Deliberate with a CDN in front of the directory, a data leak
			     anywhere else. Either way it belongs on the page. -->
			<Alert tone="warn">
				{open.length}
				{open.length === 1 ? 'provider hands' : 'providers hand'} out unsigned URLs that never
				expire. Anyone holding a key can read the object. That is what a CDN in front of the
				directory needs, and a leak if one is not there.
			</Alert>
		{/if}

		{#if active}
			<p class="text-xs text-muted">
				New uploads go to <span class="font-medium text-fg">{active.name}</span>, which has
				the lowest priority number among the providers that can take them.
			</p>
		{:else if data.providers.length > 0}
			<Alert tone="danger">
				No provider can take an upload. Every one is disabled or has credentials that will not
				decrypt.
			</Alert>
		{/if}

		<Card>
			<div class="flex flex-col gap-3 text-sm text-muted">
				<SectionHeading level={3}>How storage works</SectionHeading>
				<p>
					With nothing configured, uploads are written to a directory on the engine host, the one
					<span class="font-mono text-xs">STORAGE_LOCAL_PATH</span> names (<span class="font-mono text-xs">./uploads</span>
					by default). That is fine for one engine. With more than one replica the directory has to
					be shared storage, or each replica keeps its own files.
				</p>
				<p>
					An object store holds the files instead: Amazon S3, any S3-compatible service (Cloudflare
					R2, Wasabi, Backblaze B2, DigitalOcean Spaces) through S3 with its endpoint, MinIO, Google
					Cloud Storage or Azure Blob Storage. Credentials are stored encrypted and never shown
					again. Test a provider before enabling it: a provider with wrong credentials fails the
					uploads it receives.
				</p>
				<p>
					A tenant writes to the providers configured in that tenant. A tenant with none uses the
					providers of the default tenant, and without those, the engine's directory. Among the
					providers that can take a write, the lowest priority number receives it. Objects are kept
					under a prefix per tenant in every store.
				</p>
				<p>
					A provider is a row in this instance's database and never an environment variable. Adding
					one here changes no variable, and changing a variable will not add one. While this page is
					available, the engine's own
					<span class="font-mono text-xs">STORAGE_DRIVER</span> and
					<span class="font-mono text-xs">STORAGE_S3_*</span>
					are read by nobody: the providers below replace them rather than layering over them. The
					one exception is
					<span class="font-mono text-xs">STORAGE_LOCAL_PATH</span>, which still names the directory
					the fallback writes to.
				</p>
				<p>
					On the first boot that finds no providers at all, an instance that already had
					<span class="font-mono text-xs">STORAGE_S3_BUCKET</span>
					set gets one row built from those variables, so an install that was writing to a bucket
					keeps writing to it. That happens once. After it, this page is where the answer lives.
				</p>
			</div>
		</Card>

		{#if data.providers.length === 0}
			<EmptyState
				title="No provider configured"
				description="Uploads are written to the engine's own directory. Add an object store to keep them elsewhere."
			>
				{#snippet iconSnippet()}
					<HardDrive size={ICON.lg} />
				{/snippet}
			</EmptyState>
		{:else}
			<Table label="Storage">
				<thead>
					<tr>
						<th scope="col">Provider</th>
						<th scope="col">Writes to</th>
						<th scope="col">State</th>
						<th scope="col">Priority</th>
						<th scope="col"><span class="sr-only">Actions</span></th>
					</tr>
				</thead>
				<tbody>
					{#each data.providers as p (p.id)}
						<tr>
							<td data-cell="nowrap">
								<div class="flex items-center gap-2">
									<span class="font-medium text-fg">{p.name}</span>
									{#if active && active.id === p.id}
										<Badge tone="brand">Receiving uploads</Badge>
									{/if}
								</div>
								<div class="text-xs text-faint">{providerLabel(p.provider_type)}</div>
							</td>
							<td data-cell="nowrap" class="font-mono text-xs text-faint">{targetLabel(p)}</td>
							<td data-cell="nowrap">
								<Badge tone={providerTone(p)} dot>{providerState(p)}</Badge>
							</td>
							<td data-cell="nowrap" class="font-mono text-xs">{p.priority}</td>
							<td data-cell="nowrap">
								<div class="flex items-center justify-end gap-1">
									<form method="POST" action="?/test" use:enhance={test(p)}>
										<input type="hidden" name="id" value={p.id} />
										<Button
											variant="ghost"
											size="sm"
											type="submit"
											aria-label="Test {p.name}"
											title="Ask the provider whether it accepts the stored credentials"
										>
											<Plug size={ICON.sm} />
										</Button>
									</form>
									{#if data.canConfigure}
										<Button variant="ghost" size="sm" onclick={() => openEdit(p)} aria-label="Edit {p.name}">
											<Pencil size={ICON.sm} />
										</Button>
										<Button variant="ghost" size="sm" onclick={() => openDuplicate(p)} aria-label="Duplicate {p.name}">
											<Copy size={ICON.sm} />
										</Button>
									{/if}
									<form method="POST" action="?/delete" use:enhance={remove(p)}>
										<input type="hidden" name="id" value={p.id} />
										<Button
											variant="ghost"
											size="sm"
											type="submit"
											aria-label="Delete {p.name}"
										>
											<Trash2 size={ICON.sm} class="text-danger" />
										</Button>
									</form>
								</div>
							</td>
						</tr>
					{/each}
				</tbody>
			</Table>
		{/if}
	{/if}
</PageShell>

<Drawer bind:open={drawerOpen} title={editing ? `Edit ${editing.name}` : 'New provider'}>
	<form method="POST" action={editing ? '?/update' : '?/create'} id="provider-form" use:enhance={save.enhance} class="flex flex-col gap-4">
		{#if providerError}
			<Alert tone="danger">{providerError}</Alert>
		{/if}
		{#if editing}<input type="hidden" name="id" value={editing.id} />{/if}
		<input type="hidden" name="use_ssl" value={useSSL ? 'true' : 'false'} />
		<input type="hidden" name="path_style" value={pathStyle ? 'true' : 'false'} />
		<input type="hidden" name="enabled" value={enabled ? 'true' : 'false'} />
		<input type="hidden" name="local_public_unsigned" value={publicUnsigned ? 'true' : 'false'} />
		<Select
			id="provider-type"
			name="provider_type"
			label="Type"
			required
			options={typeOptions}
			value={kind}
			onvaluechange={(v) => (kind = v as ProviderType)}
			hint="S3 covers any S3-compatible service: set its endpoint."
		/>
		<Input id="provider-name" name="name" label="Name" required placeholder="Uploads bucket" bind:value={name} />
		{#each fields as f (f.key)}
			{#if f.multiline}
				<Textarea id="provider-{f.key}" name={f.key} label={f.label} required={f.required && !(editing && isCredential(f))} rows={6} mono hint={hintFor(f)} bind:value={values[f.key]} />
			{:else if f.secret}
				<PasswordInput
					id="provider-{f.key}"
					name={f.key}
					label={f.label}
					autocomplete="off"
					required={f.required && !editing}
					hint={hintFor(f)}
					bind:value={values[f.key]}
				/>
			{:else}
				<Input
					id="provider-{f.key}"
					name={f.key}
					label={f.label}
					required={f.required && !(editing && isCredential(f))}
					placeholder={f.placeholder}
					mono={f.key !== 'bucket'}
					hint={hintFor(f)}
					bind:value={values[f.key]}
				/>
			{/if}
		{/each}
		<Input id="provider-priority" name="priority" label="Priority" type="text" inputmode="numeric" mono hint="Lower numbers receive uploads first." bind:value={priority} />
		{#if kind === 's3' || kind === 'minio'}
			<Toggle id="provider-ssl" label="Use TLS" hint="Talk to the endpoint over HTTPS." bind:checked={useSSL} />
			<Toggle id="provider-path-style" label="Path-style addresses" hint="Needed by MinIO and some S3-compatible services that do not serve bucket subdomains." bind:checked={pathStyle} />
		{/if}
		{#if kind === 'local'}
			<Toggle
				id="provider-public"
				label="Unsigned public URLs"
				hint="Hand out the public base URL plus the key, with no signature or expiry. Only for a directory a CDN serves anyway."
				bind:checked={publicUnsigned}
			/>
		{/if}
		<Toggle id="provider-enabled" label="Enabled" hint="A disabled provider receives nothing and keeps its settings." bind:checked={enabled} />
	</form>
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (drawerOpen = false)}>Cancel</Button>
		<Button variant="primary" type="submit" form="provider-form" loading={save.pending}>{editing ? 'Save' : 'Create'}</Button>
	{/snippet}
</Drawer>
