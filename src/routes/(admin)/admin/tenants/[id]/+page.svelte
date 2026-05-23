<script lang="ts">
	import PageTitle from '$lib/components/PageTitle.svelte';
	import {
		Alert,
		Badge,
		Button,
		CheckboxGroup,
		DescriptionList,
		Drawer,
		EmptyState,
		Input,
		PageShell,
		SectionHeading,
		Table,
		confirm as confirmDialog,
	} from '@lyeve-labs/ui-kit';
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { Archive, ArchiveRestore, Pencil, Trash2 } from '@lucide/svelte';
	import { ICON } from '$lib/icon';
	import { roleTone } from '$lib/roles';
	import { formatDate } from '$lib/format';
	import type { TenantMember } from '$lib/api/tenant-access';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const tenant = $derived(data.tenant);

	// A membership names roles inside one tenant. super_admin is an instance
	// role held on the account itself, so it is not offered here.
	const MEMBER_ROLES = ['viewer', 'editor', 'admin'].map((r) => ({ value: r, label: r }));

	const facts = $derived([
		{ term: 'Slug', value: tenant.slug },
		{ term: 'Plan', value: tenant.plan },
		{ term: 'Status', value: tenant.archived ? 'Archived' : tenant.enabled ? 'Enabled' : 'Disabled' },
		{ term: 'Created', value: formatDate(tenant.created_at) },
	]);

	let available = $state<string[]>([]);
	$effect.pre(() => {
		available = (data.choices ?? []).filter((c) => c.available).map((c) => c.name);
	});
	const featureOptions = $derived((data.choices ?? []).map((c) => ({ value: c.name, label: c.name })));
	let savingFeatures = $state(false);

	let memberOpen = $state(false);
	let editingMember = $state<TenantMember | null>(null);
	let memberEmail = $state('');
	let memberRoles = $state<string[]>(['editor']);
	let savingMember = $state(false);

	function openNewMember() {
		editingMember = null;
		memberEmail = '';
		memberRoles = ['editor'];
		memberOpen = true;
	}

	function openEditMember(m: TenantMember) {
		editingMember = m;
		memberEmail = m.email;
		memberRoles = m.roles.filter((r) => r !== 'super_admin');
		memberOpen = true;
	}

	const saveMember: SubmitFunction = () => {
		savingMember = true;
		return async ({ result, update }) => {
			savingMember = false;
			if (result.type === 'success') memberOpen = false;
			await update({ reset: false });
		};
	};

	function revokeMember(email: string): SubmitFunction {
		return async ({ cancel }) => {
			const ok = await confirmDialog(
				`Remove ${email} from ${tenant.name}?`,
				'The account keeps its home tenant and every other membership. Its open sessions here end at their next refresh.',
				{ confirmLabel: 'Delete' },
			);
			if (!ok) cancel();
		};
	}

	function confirmArchive(): SubmitFunction {
		return async ({ cancel }) => {
			const ok = await confirmDialog(
				`Archive ${tenant.name}?`,
				'Reads keep working and every write is refused until the tenant is restored.',
				{ confirmLabel: 'Archive' },
			);
			if (!ok) cancel();
		};
	}
</script>

<PageTitle title={tenant.name} />

<PageShell
	title={tenant.name}
	description="What this tenant may use, and who may act in it."
	width="wide"
	back={{ href: '/admin/tenants', label: 'Tenants' }}
>
	{#snippet actions()}
		{#if tenant.archived}
			<form method="post" action="?/restore" use:enhance>
				<Button variant="secondary" size="sm" type="submit"><ArchiveRestore size={ICON.sm} /> Restore</Button>
			</form>
		{:else}
			<form method="post" action="?/archive" use:enhance={confirmArchive()}>
				<Button variant="secondary" size="sm" type="submit"><Archive size={ICON.sm} /> Archive</Button>
			</form>
		{/if}
	{/snippet}

	{#if form?.stateError}
		<Alert tone="danger">{form.stateError}</Alert>
	{/if}

	<DescriptionList items={facts} />

	<section class="flex flex-col gap-4">
		<SectionHeading level={2}>What this tenant may use</SectionHeading>
		{#if data.choices === null}
			<Alert tone="warn">The engine did not answer for this tenant's features. Reload to try again.</Alert>
		{:else if data.choices.length === 0}
			<EmptyState title="Nothing to withhold" description="This instance serves no plugin this tenant could be refused." />
		{:else}
			{#if form?.featuresError}
				<Alert tone="danger">{form.featuresError}</Alert>
			{:else if form && 'featuresSaved' in form}
				<Alert tone="success" autoDismiss>Saved. The tenant's next request follows it.</Alert>
			{/if}
			<form
				method="post"
				action="?/features"
				class="flex flex-col gap-4"
				use:enhance={() => {
					savingFeatures = true;
					return async ({ update }) => {
						savingFeatures = false;
						await update({ reset: false });
					};
				}}
			>
				{#each data.choices as c (c.name)}
					<input type="hidden" name="offered" value={c.name} />
				{/each}
				<CheckboxGroup
					name="available"
					label="Available to this tenant"
					hint="What the instance serves is the ceiling for every tenant. Clearing a box takes that plugin away from this tenant only: its routes answer 403, its screens leave the tenant's admin, and every capability it owns goes with it."
					orientation="horizontal"
					options={featureOptions}
					bind:value={available}
				/>
				<div>
					<Button variant="primary" type="submit" loading={savingFeatures}>Save</Button>
				</div>
			</form>
		{/if}
	</section>

	<section class="flex flex-col gap-4">
		<div class="flex items-center justify-between gap-4">
			<SectionHeading level={2}>Members</SectionHeading>
			<Button variant="secondary" onclick={openNewMember}>New member</Button>
		</div>
		{#if form?.memberError && !memberOpen}
			<Alert tone="danger">{form.memberError}</Alert>
		{/if}
		{#if data.members === null}
			<Alert tone="warn">The engine did not answer for this tenant's members. Reload to try again.</Alert>
		{:else if data.members.length === 0}
			<EmptyState title="No members" description="No account calls this tenant home or holds a membership in it." />
		{:else}
			<Table label="Members">
				<thead>
					<tr>
						<th scope="col">Account</th>
						<th scope="col">Roles here</th>
						<th scope="col">Access</th>
						<th scope="col" class="text-right">Actions</th>
					</tr>
				</thead>
				<tbody>
					{#each data.members as m (m.id)}
						<tr>
							<td data-cell="nowrap">
								{m.email}
								{#if m.disabled}
									<Badge tone="neutral" size="sm">Disabled</Badge>
								{/if}
							</td>
							<td>
								<div class="flex flex-wrap gap-1">
									{#each m.roles as role (role)}
										<Badge tone={roleTone(role)} size="sm">{role}</Badge>
									{/each}
								</div>
							</td>
							<td class="text-xs text-muted">{m.home ? 'Home tenant' : 'Membership'}</td>
							<td>
								<div class="flex items-center justify-end gap-2">
									<Button variant="ghost" size="sm" aria-label="Edit roles for {m.email}" onclick={() => openEditMember(m)}>
										<Pencil size={ICON.sm} />
									</Button>
									{#if !m.home}
										<form method="post" action="?/revoke" use:enhance={revokeMember(m.email)}>
											<input type="hidden" name="user_id" value={m.id} />
											<Button variant="ghost" size="sm" type="submit" aria-label="Remove {m.email}">
												<Trash2 size={ICON.sm} class="text-danger" />
											</Button>
										</form>
									{/if}
								</div>
							</td>
						</tr>
					{/each}
				</tbody>
			</Table>
			{#if data.memberTotal > data.members.length}
				<p class="text-xs text-faint">Showing {data.members.length} of {data.memberTotal} members.</p>
			{/if}
		{/if}
	</section>
</PageShell>

<Drawer bind:open={memberOpen} title={editingMember ? `Roles for ${editingMember.email}` : 'New member'}>
	<form method="post" action="?/grant" id="member-form" use:enhance={saveMember} class="flex flex-col gap-4">
		{#if form?.memberError && memberOpen}
			<Alert tone="danger">{form.memberError}</Alert>
		{/if}
		{#if editingMember}
			<input type="hidden" name="user_id" value={editingMember.id} />
			<Input id="member-email" label="Account" value={memberEmail} disabled />
		{:else}
			<Input
				id="member-email"
				name="email"
				type="email"
				label="Account email"
				required
				hint="An existing account. It keeps its home tenant and gains this one."
				bind:value={memberEmail}
			/>
		{/if}
		<CheckboxGroup
			name="roles"
			label="Roles in this tenant"
			hint={editingMember?.home
				? "Roles set here replace the account's own roles while it acts in its home tenant."
				: 'What the account may do while it acts in this tenant.'}
			options={MEMBER_ROLES}
			bind:value={memberRoles}
		/>
	</form>
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (memberOpen = false)}>Cancel</Button>
		<Button variant="primary" type="submit" form="member-form" loading={savingMember}>{editingMember ? 'Save' : 'Create'}</Button>
	{/snippet}
</Drawer>
