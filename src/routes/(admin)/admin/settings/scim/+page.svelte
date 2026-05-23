<script lang="ts">
	import PageTitle from '$lib/components/PageTitle.svelte';
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
		Select,
		Stat,
		Table,
		Toggle,
		confirm as confirmDialog,
		toast,
		Pagination,
		CopyField,
	} from '@lyeve-labs/ui-kit';
	import { enhance } from '$app/forms';
	import { tracked } from '$lib/forms.svelte';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { KeyRound, Plus, RefreshCw, Trash2 } from '@lucide/svelte';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import {
		MIN_TOKEN_LENGTH,
		SCIM_BASE_PATH,
		deprovisionLabel,
		deprovisionTone,
		type ScimProvider,
	} from '$lib/api/scim';
	import { formatDateTime } from '$lib/format';
	import type { ActionData, PageData } from './$types';
	import { pageHref, pageNumber } from '$lib/api/list';
	import { ICON } from '$lib/icon';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const formError = $derived((form as { error?: string } | null)?.error ?? '');
	const deprovisioning = $derived(data.providers.filter((p) => p.deprovision_on_delete).length);

	let creating = $state(false);
	let name = $state('');
	let token = $state('');
	let deprovisionOnDelete = $state(true);
	let action = $state('disable');

	// One rotation panel at a time, keyed by the connection it belongs to. The
	// token is write-only, so this is a field with no current value to show.
	let rotating = $state<ScimProvider | null>(null);
	let newToken = $state('');

	function openCreate() {
		name = '';
		token = '';
		deprovisionOnDelete = true;
		action = 'disable';
		creating = true;
	}

	function openRotate(p: ScimProvider) {
		rotating = p;
		newToken = '';
	}

	const saveConnection: SubmitFunction = () => {
		const subject = name;
		return async ({ result, update }) => {
			if (result.type !== 'failure') creating = false;
			await update();
			if (result.type === 'success') toast.success(`Created ${subject}`);
		};
	};

	const saveToken: SubmitFunction = () => {
		const subject = rotating?.name ?? '';
		return async ({ result, update }) => {
			if (result.type !== 'failure') rotating = null;
			await update();
			if (result.type === 'success') toast.success(`Rotated the token for ${subject}`);
		};
	};

	/**
	 * Removing a connection stops the identity provider from provisioning at
	 * all. Nothing happens to the accounts it already created, which is worth
	 * saying: an operator expecting a cleanup would otherwise get none.
	 */
	function removeConnection(p: ScimProvider): SubmitFunction {
		return async ({ cancel }) => {
			const confirmed = await confirmDialog(
				`Delete ${p.name}?`,
				'The identity provider stops being able to create or remove accounts here. Accounts it already created are left as they are.',
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

	const saveConnectionSubmit = tracked(saveConnection);
	const saveTokenSubmit = tracked(saveToken);
</script>

<PageTitle title="SCIM provisioning" />

<PageShell
	title="SCIM provisioning"
	description="Identity providers allowed to create and remove accounts here without anybody signing in."
	width="wide"
>
	{#snippet actions()}
		{#if data.gate.state === 'ok'}
			<Button variant="primary" size="sm" onclick={openCreate}>
				<Plus size={ICON.sm} /> New connection
			</Button>
		{/if}
	{/snippet}

	{#if data.gate.state !== 'ok'}
		<GateNotice
			gate={data.gate}
			title="SCIM provisioning"
			absent="The SCIM plugin is not part of this build, so no directory can provision accounts here."
		/>
	{:else}
		{#if formError}
			<Alert tone="danger">{formError}</Alert>
		{/if}

		<div class="grid gap-4 sm:grid-cols-2">
			<Stat size="sm" mono label="Connections" value={data.providers.length} />
			<Stat size="sm" mono label="Deprovisioning accounts" value={deprovisioning} />
		</div>

		<section class="flex flex-col gap-4">
			<SectionHeading level={2}>Where the directory sends its requests</SectionHeading>
			<CopyField label="Base path" labelHidden value={SCIM_BASE_PATH} copyLabel="Copy base path" />
			<p class="text-xs text-muted">
				Give the directory this path under the URL it reaches this instance at, and the bearer
				token from the connection below. The token is the whole authentication for these
				endpoints.
			</p>
		</section>

		<section class="flex flex-col gap-4">
			<SectionHeading level={2}>Connections</SectionHeading>

			{#if data.providers.length === 0}
				<EmptyState
					title="No directory is connected"
					description="Add a connection to let an identity provider manage accounts here."
				>
					{#snippet iconSnippet()}
						<KeyRound size={ICON.lg} />
					{/snippet}
					{#snippet action()}
						<Button variant="secondary" onclick={openCreate}>
							<Plus size={ICON.sm} /> New connection
						</Button>
					{/snippet}
				</EmptyState>
			{:else}
				<Table label="Connections">
					<thead>
						<tr>
							<th scope="col">Connection</th>
							<th scope="col">Deprovisioned accounts are</th>
							<th scope="col">Created</th>
							<th scope="col"><span class="sr-only">Actions</span></th>
						</tr>
					</thead>
					<tbody>
						{#each data.providers as p (p.id)}
							<tr>
								<td data-cell="nowrap">
									<div class="flex items-center gap-2">
										<span class="font-medium text-fg">{p.name}</span>
										<Badge tone={p.enabled ? 'success' : 'neutral'} dot>
											{p.enabled ? 'Enabled' : 'Disabled'}
										</Badge>
									</div>
								</td>
								<td data-cell="nowrap">
									<Badge tone={deprovisionTone(p)}>{deprovisionLabel(p)}</Badge>
								</td>
								<td data-cell="nowrap" class="text-xs text-faint">
									{formatDateTime(p.created_at)}
								</td>
								<td data-cell="nowrap">
									<div class="flex items-center justify-end gap-1">
										<Button
											variant="ghost"
											size="sm"
											aria-label="Rotate the token for {p.name}"
											title="Rotate token"
											onclick={() => openRotate(p)}
										>
											<RefreshCw size={ICON.sm} />
										</Button>
										<form method="POST" action="?/delete" use:enhance={removeConnection(p)}>
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
					href={pageHref('/admin/settings/scim', data.limit)}
				/>
			{/if}
		</section>
	{/if}
</PageShell>

<Drawer bind:open={creating} title="New connection">
	<form id="scim-connection-form" method="POST" action="?/create" use:enhance={saveConnectionSubmit.enhance}>
		<div class="flex flex-col gap-4">
			<Input
				id="scim-name"
				name="name"
				label="Name"
				hint="Which directory this is. Nobody outside this screen reads it."
				bind:value={name}
				required
			/>
			<PasswordInput
				id="scim-token"
				name="bearer_token"
				label="Bearer token"
				hint="At least {MIN_TOKEN_LENGTH} characters. Stored as a hash, so this is the only time it can be read. Copy it into the directory now."
				bind:value={token}
				required
			/>
			<Select
				id="scim-deprovision-action"
				name="deprovision_action"
				label="When the directory removes somebody"
				hint="Disabling keeps the account and its history. Deleting does not, and cannot be undone."
				bind:value={action}
				options={[
					{ value: 'disable', label: 'Disable the account' },
					{ value: 'delete', label: 'Delete the account' },
				]}
			/>
			<!-- Toggle renders a button, and a button submits nothing. The action
			     reads an absent field as false, which would silently store a
			     connection that never deprovisions anybody. -->
			<input
				type="hidden"
				name="deprovision_on_delete"
				value={deprovisionOnDelete ? 'true' : 'false'}
			/>
			<Toggle
				id="scim-deprovision"
				label="Act on removals at all"
				hint="Off means an account stays exactly as it is when the directory stops listing it."
				bind:checked={deprovisionOnDelete}
			/>
		</div>
	</form>
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (creating = false)}>Cancel</Button>
		<Button variant="primary" type="submit" form="scim-connection-form" loading={saveConnectionSubmit.pending}>Create</Button>
	{/snippet}
</Drawer>

<Drawer
	open={rotating !== null}
	onclose={() => (rotating = null)}
	title={rotating ? `Rotate the token for ${rotating.name}` : 'Rotate token'}
>
	<form id="scim-rotate-form" method="POST" action="?/rotate" use:enhance={saveTokenSubmit.enhance}>
		<input type="hidden" name="id" value={rotating?.id ?? ''} />
		<div class="flex flex-col gap-4">
			<Alert tone="warn">
				The old token stops working the moment this one is stored. Provisioning fails until
				the directory is updated with the new one.
			</Alert>
			<PasswordInput
				id="scim-new-token"
				name="new_token"
				label="New bearer token"
				hint="At least {MIN_TOKEN_LENGTH} characters."
				bind:value={newToken}
				required
			/>
		</div>
	</form>
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (rotating = null)}>Cancel</Button>
		<Button variant="primary" type="submit" form="scim-rotate-form" loading={saveTokenSubmit.pending}>Save</Button>
	{/snippet}
</Drawer>
