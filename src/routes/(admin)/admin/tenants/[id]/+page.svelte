<script lang="ts">
	import {
		Alert,
		Badge,
		Button,
		CheckboxGroup,
		DescriptionList,
		Drawer,
		EmptyState,
		Input,
		MultiSelect,
		PageShell,
		Pagination,
		SectionHeading,
		Table,
	} from '@lyeve-labs/ui-kit';
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { Archive, ArchiveRestore, Pencil, Plus, Trash2 } from '@lucide/svelte';
	import { ICON } from '$lib/icon';
	import { roleTone } from '$lib/roles';
	import { pageHref, pageNumber } from '$lib/api/list';
	import { formatDate } from '$lib/format';
	import type { TenantMember } from '$lib/api/tenant-access';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import FormErrors from '$lib/components/FormErrors.svelte';
	import { confirmed, fieldErrors } from '$lib/forms.svelte';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const tenant = $derived(data.tenant);

	// A membership names roles inside one tenant. super_admin is an instance
	// role held on the account itself, so it is not offered here. A row that
	// already holds it keeps it: the engine signs a home tenant in with the
	// roles saved here, so a save without it would end the account's super
	// admin at its next sign-in, and this page offers no way back.
	const MEMBER_ROLES = ['viewer', 'editor', 'admin'].map((r) => ({ value: r, label: r }));

	const facts = $derived([
		{ term: 'Slug', value: tenant.slug },
		{ term: 'Plan', value: tenant.plan },
		{ term: 'Status', value: tenant.archived ? 'Archived' : tenant.enabled ? 'Enabled' : 'Disabled' },
		{ term: 'Created', value: formatDate(tenant.created_at) },
	]);

	/*
	 * The picks are seeded from what the engine stores and reseeded only when
	 * that changes. Turning a members page reruns the load and hands back an
	 * equal list as a new object, which must not undo a pick not yet saved.
	 */
	function storedPicks(): string[] {
		return (data.choices.ok ? data.choices.value : []).filter((c) => c.available).map((c) => c.name);
	}
	function choicesKey(): string {
		return JSON.stringify(data.choices.ok ? data.choices.value : null);
	}
	// svelte-ignore state_referenced_locally
	let available = $state<string[]>(storedPicks());
	// svelte-ignore state_referenced_locally
	let seededFrom = choicesKey();
	$effect.pre(() => {
		const key = choicesKey();
		if (key === seededFrom) return;
		seededFrom = key;
		available = storedPicks();
	});
	const featureOptions = $derived((data.choices.ok ? data.choices.value : []).map((c) => ({ value: c.name, label: c.name })));
	let savingFeatures = $state(false);

	let memberOpen = $state(false);
	let editingMember = $state<TenantMember | null>(null);
	let memberEmail = $state('');
	let memberRoles = $state<string[]>(['editor']);
	let savingMember = $state(false);

	/*
	 * A grant and a removal both answer in memberError, and each names its
	 * action. The drawer shows only a failed grant that came back after it was
	 * opened, so a failed removal never reads as a failure of the form opened
	 * next. A failed removal shows above the members.
	 */
	type MemberFailure = { action?: string; memberError?: string; fields?: Record<string, string> } | null;
	let openedOver = $state.raw<unknown>(null);
	const memberFailure = $derived(form as MemberFailure);
	const grantError = $derived(
		memberFailure?.action === 'grant' && form !== openedOver ? memberFailure.memberError : undefined,
	);
	const revokeError = $derived(memberFailure?.action === 'revoke' ? memberFailure.memberError : undefined);

	function openNewMember() {
		openedOver = form;
		editingMember = null;
		memberEmail = '';
		memberRoles = ['editor'];
		memberOpen = true;
	}

	function openEditMember(m: TenantMember) {
		openedOver = form;
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

	// Each question is built at submit time, so it names the tenant as it
	// reads after a rename rather than as it read when the row first drew.
	function revokeMember(email: string): SubmitFunction {
		return (input) =>
			confirmed(
				`Remove ${email} from ${tenant.name}?`,
				'The account keeps its home tenant and every other membership. Its open sessions here end at their next refresh.',
				{ confirmLabel: 'Delete' },
			)(input);
	}

	function confirmArchive(): SubmitFunction {
		return (input) =>
			confirmed(
				`Archive ${tenant.name}?`,
				'Reads keep working and every write is refused until the tenant is restored.',
				{ confirmLabel: 'Archive' },
			)(input);
	}
</script>

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
		{#if !data.choices.ok}
			<GateNotice
				gate={data.choices.gate}
				title="this tenant's features"
				absent="This instance does not serve per-tenant features."
			/>
		{:else if data.choices.value.length === 0}
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
				{#each data.choices.value as c (c.name)}
					<input type="hidden" name="offered" value={c.name} />
				{/each}
				<MultiSelect
					id="tenant-features"
					label="Available to this tenant"
					placeholder="Nothing"
					hint="What the instance serves is the ceiling for every tenant. Removing a plugin here takes it away from this tenant only: its routes answer 403, its screens leave the tenant's admin, and every capability it owns goes with it."
					searchable
					options={featureOptions}
					bind:value={available}
				/>
				{#each available as name (name)}
					<input type="hidden" name="available" value={name} />
				{/each}
				<div>
					<Button variant="primary" type="submit" loading={savingFeatures}>Save</Button>
				</div>
			</form>
		{/if}
	</section>

	<section class="flex flex-col gap-4">
		<div class="flex items-center justify-between gap-4">
			<SectionHeading level={2}>Members</SectionHeading>
			{#if data.members.ok}
				<Button variant="secondary" onclick={openNewMember}><Plus size={ICON.sm} /> New member</Button>
			{/if}
		</div>
		{#if revokeError}
			<Alert tone="danger">{revokeError}</Alert>
		{/if}
		{#if !data.members.ok}
			<GateNotice
				gate={data.members.gate}
				title="this tenant's members"
				absent="The multitenant plugin does not serve tenant members on this instance."
			/>
		{:else if data.members.value.length === 0}
			<EmptyState title="No members" description="No account calls this tenant home or holds a membership in it.">
				{#snippet action()}
					<Button variant="secondary" onclick={openNewMember}><Plus size={ICON.sm} /> New member</Button>
				{/snippet}
			</EmptyState>
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
					{#each data.members.value as m (m.id)}
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
			<Pagination
				page={pageNumber(data.offset, data.limit)}
				perPage={data.limit}
				count={data.members.value.length}
				total={data.memberTotal}
				noun="members"
				href={pageHref(`/admin/tenants/${tenant.id}`, data.limit)}
			/>
		{/if}
	</section>
</PageShell>

<Drawer bind:open={memberOpen} title={editingMember ? `Roles for ${editingMember.email}` : 'New member'}>
	<form method="post" action="?/grant" id="member-form" use:enhance={saveMember} class="flex flex-col gap-4">
		<FormErrors message={grantError} fields={grantError ? fieldErrors(form) : {}} />
		{#if editingMember}
			<input type="hidden" name="user_id" value={editingMember.id} />
			<Input id="member-email" label="Account" value={memberEmail} disabled />
			{#if editingMember.roles.includes('super_admin')}
				<input type="hidden" name="roles" value="super_admin" />
				<p class="text-xs text-muted" data-testid="keeps-super-admin">
					This account is a super admin, and saving here keeps that role. The super admin role is managed on the Users page.
				</p>
			{/if}
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
