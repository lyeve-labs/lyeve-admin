<script lang="ts">
	import PageTitle from '$lib/components/PageTitle.svelte';
	import {
		Alert,
		Badge,
		Button,
		CopyButton,
		Drawer,
		EmptyState,
		Input,
		PageShell,
		SearchInput,
		SectionHeading,
		Stat,
		Table,
		Textarea,
		Toggle,
		confirm as confirmDialog,
		toast,
		Pagination,
	} from '@lyeve-labs/ui-kit';
	import { enhance } from '$app/forms';
	import { tracked } from '$lib/forms.svelte';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { KeyRound, Pencil, Plus, RefreshCw, ShieldCheck, Trash2 } from '@lucide/svelte';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import ListToolbar from '$lib/components/ListToolbar.svelte';
	import {
		certTone,
		expiryLabel,
		metadataPath,
		providerHealth,
		signInPath,
		type SamlProvider,
	} from '$lib/api/saml';
	import { NO_VALUE, formatDate } from '$lib/format';
	import type { ActionData, PageData } from './$types';
	import { pageHref, pageNumber } from '$lib/api/list';
	import { ICON } from '$lib/icon';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const formError = $derived((form as { error?: string } | null)?.error ?? '');

	let narrow = $state('');
	const visible = $derived(
		narrow.trim()
			? data.providers.filter((p) =>
					`${p.name} ${p.entity_id}`.toLowerCase().includes(narrow.trim().toLowerCase()),
				)
			: data.providers,
	);

	const enabledCount = $derived(data.providers.filter((p) => p.enabled).length);
	// A certificate nobody renews takes the instance down on a date. This is the
	// number that should make somebody act, so it counts expired ones too.
	const needingAttention = $derived(
		data.providers.filter((p) => providerHealth(p) === 'expired' || providerHealth(p) === 'expiring')
			.length,
	);
	const staged = $derived(data.providers.filter((p) => !!p.sp_cert_next));

	// One drawer for both writes: a null target is a new provider.
	let open = $state(false);
	let editing = $state<SamlProvider | null>(null);

	let name = $state('');
	let entityId = $state('');
	let ssoUrl = $state('');
	let sloUrl = $state('');
	let idpCert = $state('');
	let nameIdFormat = $state('');
	let attributes = $state('');
	let wantAssertionsSigned = $state(true);
	let wantResponseSigned = $state(true);
	let signAuthnRequests = $state(true);
	let encryptAssertions = $state(false);
	let enabled = $state(true);

	const EMAIL_NAME_ID = 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress';

	function openCreate() {
		editing = null;
		name = '';
		entityId = '';
		ssoUrl = '';
		sloUrl = '';
		idpCert = '';
		nameIdFormat = EMAIL_NAME_ID;
		attributes = 'email=email\nroles=groups';
		wantAssertionsSigned = true;
		wantResponseSigned = true;
		signAuthnRequests = true;
		encryptAssertions = false;
		enabled = true;
		open = true;
	}

	function openEdit(p: SamlProvider) {
		editing = p;
		name = p.name;
		entityId = p.entity_id;
		ssoUrl = p.sso_url;
		sloUrl = p.slo_url ?? '';
		// Left empty on purpose: the engine never sends the stored certificate
		// back, and an empty field means "keep it" rather than "clear it".
		idpCert = '';
		nameIdFormat = p.name_id_format;
		attributes = Object.entries(p.attributes_mapping ?? {})
			.map(([k, v]) => `${k}=${v}`)
			.join('\n');
		wantAssertionsSigned = p.want_assertions_signed;
		wantResponseSigned = p.want_response_signed;
		signAuthnRequests = p.sign_authn_requests;
		encryptAssertions = p.encrypt_assertions;
		enabled = p.enabled;
		open = true;
	}

	/** Closes the drawer once the write lands. A failure keeps it open beside the message. */
	const saveProvider: SubmitFunction = () => {
		const subject = name;
		const verb = editing ? 'Saved' : 'Created';
		return async ({ result, update }) => {
			if (result.type !== 'failure') open = false;
			await update();
			if (result.type === 'success') toast.success(`${verb} ${subject}`);
		};
	};

	/**
	 * Removing a provider ends every sign-in that goes through it, and there is
	 * no undo: the private key is deleted with the row.
	 */
	function removeProvider(p: SamlProvider): SubmitFunction {
		return async ({ cancel }) => {
			const confirmed = await confirmDialog(
				`Delete ${p.name}?`,
				'Anyone who signs in through this provider will lose access, and the private key is deleted with it.',
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

	/**
	 * Promoting is the step that changes what signatures carry, so it asks
	 * first and says what has to be true before it is safe.
	 */
	function promote(p: SamlProvider): SubmitFunction {
		return async ({ cancel }) => {
			const confirmed = await confirmDialog(
				`Promote the new certificate for ${p.name}?`,
				'Every request will be signed with it from now on. Do this once the identity provider has read the metadata document and trusts it.',
				{ confirmLabel: 'Promote' },
			);
			if (!confirmed) {
				cancel();
				return;
			}
			return async ({ result, update }) => {
				await update();
				if (result.type === 'success') toast.success(`${p.name} is using the new certificate`);
			};
		};
	}

	const saveProviderSubmit = tracked(saveProvider);
</script>

<PageTitle title="SAML SSO" />

<PageShell
	title="SAML SSO"
	description="Identity providers people sign in through, and the certificates that keep them working."
	width="wide"
>
	{#snippet actions()}
		{#if data.gate.state === 'ok'}
			<Button variant="primary" size="sm" onclick={openCreate}>
				<Plus size={ICON.sm} /> New provider
			</Button>
		{/if}
	{/snippet}

	{#if data.gate.state !== 'ok'}
		<GateNotice
			gate={data.gate}
			title="SAML SSO"
			absent="The SAML plugin is not part of this build, so no identity provider can be configured here."
		/>
	{:else}
		{#if formError}
			<Alert tone="danger">{formError}</Alert>
		{/if}

		<div class="grid gap-4 sm:grid-cols-3">
			<Stat size="sm" mono label="Providers" value={data.providers.length} />
			<Stat size="sm" mono label="Enabled" value={enabledCount} />
			<Stat
				size="sm"
				mono
				label="Certificates to renew"
				value={needingAttention}
				tone={needingAttention > 0 ? 'warn' : 'neutral'}
			/>
		</div>

		{#if staged.length > 0}
			<section class="flex flex-col gap-4">
				<SectionHeading level={2}>Waiting to be promoted</SectionHeading>
				<p class="text-xs text-muted">
					A new certificate is staged and published in the metadata document beside the one in
					use. Point the identity provider at the metadata URL, or hand it the certificate
					below, then promote. Until you promote, nothing changes.
				</p>
				<div class="flex flex-col gap-3">
					{#each staged as p (p.id)}
						<div class="rounded border border-line bg-surface-2 p-3">
							<div class="flex flex-wrap items-center justify-between gap-2">
								<div class="min-w-0">
									<span class="font-medium text-fg">{p.name}</span>
									<span class="ml-2 text-xs text-faint">
										New certificate {expiryLabel(p.sp_cert_next_expires_at).toLowerCase()}
									</span>
								</div>
								<div class="flex items-center gap-2">
									<CopyButton value={p.sp_cert_next ?? ''} label="Copy certificate" />
									<form method="POST" action="?/rollover" use:enhance={promote(p)}>
										<input type="hidden" name="id" value={p.id} />
										<Button variant="primary" size="sm" type="submit">Promote</Button>
									</form>
								</div>
							</div>
						</div>
					{/each}
				</div>
			</section>
		{/if}

		<section class="flex flex-col gap-4">
			<SectionHeading level={2}>Providers</SectionHeading>

			{#if data.providers.length === 0}
				<EmptyState
					title="No identity provider is configured"
					description="Add one to put a sign-in button on the login page."
				>
					{#snippet iconSnippet()}
						<KeyRound size={ICON.lg} />
					{/snippet}
					{#snippet action()}
						<Button variant="secondary" onclick={openCreate}>
							<Plus size={ICON.sm} /> New provider
						</Button>
					{/snippet}
				</EmptyState>
			{:else}
				<ListToolbar label="Filter providers">
					{#snippet search()}
						<SearchInput bind:value={narrow} placeholder="Search providers" />
					{/snippet}
				</ListToolbar>

				{#if visible.length === 0}
					<EmptyState
						title="No provider matches"
						description="Nothing here is named or points at what you searched for."
					>
						{#snippet iconSnippet()}
							<ShieldCheck size={ICON.lg} />
						{/snippet}
					</EmptyState>
				{:else}
					<Table label="Providers">
						<thead>
							<tr>
								<th scope="col">Provider</th>
								<th scope="col">Identity provider</th>
								<th scope="col">Our certificate</th>
								<th scope="col">Their certificate</th>
								<th scope="col"><span class="sr-only">Actions</span></th>
							</tr>
						</thead>
						<tbody>
							{#each visible as p (p.id)}
								<tr>
									<td data-cell="nowrap">
										<div class="flex items-center gap-2">
											<span class="font-medium text-fg">{p.name}</span>
											<Badge tone={p.enabled ? 'success' : 'neutral'} dot>
												{p.enabled ? 'Enabled' : 'Disabled'}
											</Badge>
										</div>
										<div class="text-xs text-faint">
											<a class="underline" href={metadataPath(p.name)}>Metadata</a>
											<span class="mx-1">·</span>
											<a class="underline" href={signInPath(p.name)}>Test sign-in</a>
										</div>
									</td>
									<td class="max-w-xs truncate text-xs text-faint" title={p.entity_id}>
										{p.entity_id || NO_VALUE}
									</td>
									<td data-cell="nowrap">
										<Badge tone={certTone(providerHealth({ ...p, idp_cert_expires_at: null }))}>
											{formatDate(p.sp_cert_expires_at)}
										</Badge>
										<div class="text-xs text-faint">{expiryLabel(p.sp_cert_expires_at)}</div>
									</td>
									<td data-cell="nowrap">
										<Badge tone={certTone(providerHealth({ ...p, sp_cert_expires_at: null }))}>
											{formatDate(p.idp_cert_expires_at)}
										</Badge>
										<div class="text-xs text-faint">{expiryLabel(p.idp_cert_expires_at)}</div>
									</td>
									<td data-cell="nowrap">
										<div class="flex items-center justify-end gap-1">
											{#if !p.sp_cert_next}
												<form method="POST" action="?/prepare" use:enhance>
													<input type="hidden" name="id" value={p.id} />
													<Button
														variant="ghost"
														size="sm"
														type="submit"
														aria-label="Prepare a new certificate for {p.name}"
														title="Prepare a new certificate"
													>
														<RefreshCw size={ICON.sm} />
													</Button>
												</form>
											{/if}
											<Button
												variant="ghost"
												size="sm"
												aria-label="Edit {p.name}"
												onclick={() => openEdit(p)}
											>
												<Pencil size={ICON.sm} />
											</Button>
											<form method="POST" action="?/delete" use:enhance={removeProvider(p)}>
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
					<Pagination
						page={pageNumber(data.offset, data.limit)}
						perPage={data.limit}
						count={data.providers.length}
						total={data.total ?? undefined}
						hasNext={data.hasMore}
						noun="providers"
						href={pageHref('/admin/settings/saml', data.limit)}
					/>
				{/if}
			{/if}
		</section>
	{/if}
</PageShell>

<Drawer bind:open title={editing ? `Edit ${editing.name}` : 'New provider'}>
	<form
		id="saml-provider-form"
		method="POST"
		action={editing ? '?/update' : '?/create'}
		use:enhance={saveProviderSubmit.enhance}
	>
		{#if editing}
			<input type="hidden" name="id" value={editing.id} />
		{/if}

		<div class="flex flex-col gap-4">
			<Input
				id="saml-name"
				name="name"
				label="Name"
				hint="What the sign-in button says. People read this, so write it the way they know the provider."
				bind:value={name}
				required
			/>
			<Input
				id="saml-entity-id"
				name="entity_id"
				label="Entity ID"
				hint="The identity provider's own identifier, from its metadata."
				bind:value={entityId}
				required
			/>
			<Input
				id="saml-sso-url"
				name="sso_url"
				label="Sign-on URL"
				hint="Where people are sent to authenticate."
				bind:value={ssoUrl}
				required
			/>
			<Input
				id="saml-slo-url"
				name="slo_url"
				label="Sign-out URL"
				hint="Optional. Leave empty when the provider does not offer single logout."
				bind:value={sloUrl}
			/>
			<Textarea
				id="saml-idp-cert"
				name="idp_cert"
				label="Their signing certificate"
				hint={editing
					? 'Leave empty to keep the stored certificate. Paste a new one to replace it.'
					: 'PEM from the identity provider. Every assertion is verified against this.'}
				rows={6}
				bind:value={idpCert}
			/>
			<Input
				id="saml-name-id"
				name="name_id_format"
				label="NameID format"
				hint="Which identifier the assertion carries. Email address suits most providers."
				bind:value={nameIdFormat}
			/>
			<Textarea
				id="saml-attributes"
				name="attributes_mapping"
				label="Attribute mapping"
				hint="One per line, as claim=field. A line with no equals sign is ignored."
				rows={4}
				bind:value={attributes}
			/>

			<!-- Toggle renders a button, and a button submits nothing. Each state
			     reaches the action through the hidden field beside it, and every
			     one of these is a security setting, so an unchecked switch has to
			     say false rather than go missing. -->
			<input
				type="hidden"
				name="want_assertions_signed"
				value={wantAssertionsSigned ? 'true' : 'false'}
			/>
			<Toggle
				id="saml-want-assertions-signed"
				label="Require signed assertions"
				bind:checked={wantAssertionsSigned}
			/>
			<input
				type="hidden"
				name="want_response_signed"
				value={wantResponseSigned ? 'true' : 'false'}
			/>
			<Toggle
				id="saml-want-response-signed"
				label="Require a signed response"
				bind:checked={wantResponseSigned}
			/>
			<input
				type="hidden"
				name="sign_authn_requests"
				value={signAuthnRequests ? 'true' : 'false'}
			/>
			<Toggle
				id="saml-sign-authn"
				label="Sign our requests"
				bind:checked={signAuthnRequests}
			/>
			<input
				type="hidden"
				name="encrypt_assertions"
				value={encryptAssertions ? 'true' : 'false'}
			/>
			<Toggle
				id="saml-encrypt"
				label="Expect encrypted assertions"
				bind:checked={encryptAssertions}
			/>
			<input type="hidden" name="enabled" value={enabled ? 'true' : 'false'} />
			<Toggle
				id="saml-enabled"
				label="Show on the sign-in page"
				bind:checked={enabled}
			/>
		</div>
	</form>
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (open = false)}>Cancel</Button>
		<Button variant="primary" type="submit" form="saml-provider-form" loading={saveProviderSubmit.pending}>
			{editing ? 'Save' : 'Create'}
		</Button>
	{/snippet}
</Drawer>
