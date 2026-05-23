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
		SectionHeading,
		Stat,
		Table,
		Toggle,
		confirm as confirmDialog,
		toast,
	} from '@lyeve-labs/ui-kit';
	import { enhance } from '$app/forms';
	import { tracked } from '$lib/forms.svelte';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { Globe, MapPin, Pencil, Plus, Trash2 } from '@lucide/svelte';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import {
		REGION_STATE_LABELS,
		occupancy,
		regionState,
		regionTone,
		replicationLabel,
		replicationTone,
		reportIsPartial,
		unassigned,
		type Region,
	} from '$lib/api/residency';
	import { formatDateTime } from '$lib/format';
	import type { ActionData, PageData } from './$types';
	import { ICON } from '$lib/icon';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const formError = $derived((form as { error?: string } | null)?.error ?? '');
	const summary = $derived(data.report?.summary ?? null);
	const stranded = $derived(unassigned(data.report));
	const partial = $derived(reportIsPartial(data.report));
	const perRegion = $derived(occupancy(data.report));

	let open = $state(false);
	let editing = $state<Region | null>(null);

	let slug = $state('');
	let displayName = $state('');
	let provider = $state('aws');
	let lat = $state('');
	let long = $state('');
	let enabled = $state(true);
	let isDefault = $state(false);

	function openCreate() {
		editing = null;
		slug = '';
		displayName = '';
		provider = 'aws';
		lat = '';
		long = '';
		enabled = true;
		isDefault = false;
		open = true;
	}

	function openEdit(r: Region) {
		editing = r;
		slug = r.slug;
		displayName = r.display_name;
		provider = r.provider;
		lat = r.coordinates ? String(r.coordinates.lat) : '';
		long = r.coordinates ? String(r.coordinates.long) : '';
		enabled = r.enabled;
		isDefault = r.is_default;
		open = true;
	}

	const saveRegion: SubmitFunction = () => {
		const subject = displayName;
		const verb = editing ? 'Saved' : 'Created';
		return async ({ result, update }) => {
			if (result.type !== 'failure') open = false;
			await update();
			if (result.type === 'success') toast.success(`${verb} ${subject}`);
		};
	};

	/**
	 * Tenants assigned to a region do not move when it is deleted, so this is
	 * the point at which a residency record can silently stop being true.
	 */
	function removeRegion(r: Region): SubmitFunction {
		return async ({ cancel }) => {
			const confirmed = await confirmDialog(
				`Delete ${r.display_name}?`,
				'Tenants assigned to it are not moved. Move them first, or the report stops accounting for where their data is.',
				{ confirmLabel: 'Delete' },
			);
			if (!confirmed) {
				cancel();
				return;
			}
			return async ({ result, update }) => {
				await update();
				if (result.type === 'success') toast.success(`Deleted ${r.display_name}`);
			};
		};
	}

	const saveRegionSubmit = tracked(saveRegion);
</script>

<PageTitle title="Data residency" />

<PageShell
	title="Data residency"
	description="The regions this instance runs in, and which tenant's data sits in each."
	width="wide"
	back={{ href: '/admin/settings', label: 'Settings' }}
>
	{#snippet actions()}
		{#if data.permitted && data.gate.state === 'ok'}
			<Button variant="primary" size="sm" onclick={openCreate}>
				<Plus size={ICON.sm} /> New region
			</Button>
		{/if}
	{/snippet}

	{#if !data.permitted}
		<Alert tone="brand">
			Regions are instance infrastructure and the residency report covers every tenant, so both
			are a super admin's to read.
		</Alert>
	{:else if data.gate.state !== 'ok'}
		<GateNotice
			gate={data.gate}
			title="Data residency"
			absent="The data residency plugin is not part of this build, so no region is recorded."
		/>
	{:else}
		{#if formError}
			<Alert tone="danger">{formError}</Alert>
		{/if}

		<section class="flex flex-col gap-4">
			<SectionHeading level={2}>Where tenants are</SectionHeading>

			{#if !data.reportRead}
				<!-- An unread report is never drawn as a clean one. Zero unassigned
				     tenants because nobody could ask is the worst answer here. -->
				<Alert tone="danger">
					The residency report could not be read. This is not a report that every tenant is
					placed.
				</Alert>
			{:else if summary}
				<div class="grid gap-4 sm:grid-cols-4">
					<Stat size="sm" mono label="Regions" value={summary.total_regions} />
					<Stat size="sm" mono label="Tenants" value={summary.total_tenants} />
					<Stat size="sm" mono label="Replicated" value={summary.replicating_count} />
					<Stat
						size="sm"
						mono
						label="Not placed"
						value={stranded}
						tone={stranded > 0 ? 'danger' : 'neutral'}
					/>
				</div>

				{#if stranded > 0}
					<!-- The number that reads as harmless and is not. A tenant with no
					     region is not in a compliant default, it is unaccounted for. -->
					<Alert tone="danger">
						{stranded}
						{stranded === 1 ? 'tenant has' : 'tenants have'} no region assigned. That is not a
						default placement: this report cannot say where that data is.
					</Alert>
				{/if}

				{#if partial}
					<Alert tone="warn">
						This report lists fewer tenants than it counts. It is a page of the data, not a
						complete audit, so do not hand it over as one.
					</Alert>
				{/if}

				<p class="text-xs text-muted">
					Generated {formatDateTime(data.report?.generated_at)}.
				</p>

				{#if perRegion.length > 0}
					<Table label="Tenants per region">
						<thead>
							<tr>
								<th scope="col">Region</th>
								<th scope="col">Tenants</th>
							</tr>
						</thead>
						<tbody>
							{#each perRegion as row (row.slug)}
								<tr>
									<td data-cell="nowrap" class="font-mono text-xs">{row.slug}</td>
									<td data-cell="nowrap" class="font-mono text-xs">{row.tenants}</td>
								</tr>
							{/each}
						</tbody>
					</Table>
				{/if}

				{#if (data.report?.tenant_regions ?? []).length > 0}
					<Table label="Where each tenant is">
						<thead>
							<tr>
								<th scope="col">Tenant</th>
								<th scope="col">Region</th>
								<th scope="col">Replica</th>
								<th scope="col">Assigned</th>
							</tr>
						</thead>
						<tbody>
							{#each data.report?.tenant_regions ?? [] as t (t.tenant_id)}
								<tr>
									<td data-cell="nowrap">
										<span class="font-medium text-fg">{t.tenant_name || t.tenant_slug}</span>
										<div class="font-mono text-xs text-faint">{t.tenant_slug}</div>
									</td>
									<td data-cell="nowrap">
										<span class="font-mono text-xs">{t.region_slug}</span>
										<div class="text-xs text-faint">{t.provider}</div>
									</td>
									<td data-cell="nowrap">
										<Badge tone={t.has_replica ? replicationTone(t.replica_status) : 'neutral'}>
											{t.has_replica ? replicationLabel(t.replica_status) : 'None'}
										</Badge>
									</td>
									<td data-cell="nowrap" class="text-xs text-faint">
										{formatDateTime(t.assigned_at)}
									</td>
								</tr>
							{/each}
						</tbody>
					</Table>
				{/if}
			{:else}
				<EmptyState
					title="Nothing to report yet"
					description="No tenant has been assigned a region, so there is nothing to account for."
				>
					{#snippet iconSnippet()}
						<Globe size={ICON.lg} />
					{/snippet}
				</EmptyState>
			{/if}
		</section>

		<section class="flex flex-col gap-4">
			<SectionHeading level={2}>Regions</SectionHeading>

			{#if data.regions.length === 0}
				<EmptyState
					title="No region is defined"
					description="Define at least one before a tenant can be placed anywhere."
				>
					{#snippet iconSnippet()}
						<MapPin size={ICON.lg} />
					{/snippet}
					{#snippet action()}
						<Button variant="secondary" onclick={openCreate}>
							<Plus size={ICON.sm} /> New region
						</Button>
					{/snippet}
				</EmptyState>
			{:else}
				<Table label="Regions">
					<thead>
						<tr>
							<th scope="col">Region</th>
							<th scope="col">Runs on</th>
							<th scope="col">State</th>
							<th scope="col"><span class="sr-only">Actions</span></th>
						</tr>
					</thead>
					<tbody>
						{#each data.regions as r (r.id)}
							<tr>
								<td data-cell="nowrap">
									<span class="font-medium text-fg">{r.display_name}</span>
									<div class="font-mono text-xs text-faint">{r.slug}</div>
								</td>
								<td data-cell="nowrap" class="text-xs text-faint">{r.provider}</td>
								<td data-cell="nowrap">
									<Badge tone={regionTone(regionState(r))} dot>
										{REGION_STATE_LABELS[regionState(r)]}
									</Badge>
								</td>
								<td data-cell="nowrap">
									<div class="flex items-center justify-end gap-1">
										<Button
											variant="ghost"
											size="sm"
											aria-label="Edit {r.display_name}"
											onclick={() => openEdit(r)}
										>
											<Pencil size={ICON.sm} />
										</Button>
										<form method="POST" action="?/delete" use:enhance={removeRegion(r)}>
											<input type="hidden" name="id" value={r.id} />
											<Button
												variant="ghost"
												size="sm"
												type="submit"
												aria-label="Delete {r.display_name}"
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
		</section>
	{/if}
</PageShell>

<Drawer bind:open title={editing ? `Edit ${editing.display_name}` : 'New region'}>
	<form
		id="region-form"
		method="POST"
		action={editing ? '?/update' : '?/create'}
		use:enhance={saveRegionSubmit.enhance}
	>
		{#if editing}
			<input type="hidden" name="id" value={editing.id} />
		{/if}

		<div class="flex flex-col gap-4">
			{#if editing}
				<!-- The slug is copied onto every tenant assignment and onto the
				     report, so changing it would leave those rows naming a region
				     that no longer exists. -->
				<Input
					id="region-slug-fixed"
					label="Slug"
					value={slug}
					hint="Fixed once created. It is written onto every assignment and onto the report."
					readonly
				/>
			{:else}
				<Input
					id="region-slug"
					name="slug"
					label="Slug"
					hint="Lower case, digits and hyphens, such as eu-west-1. It cannot be changed later."
					bind:value={slug}
					required
				/>
			{/if}
			<Input
				id="region-name"
				name="display_name"
				label="Name"
				hint="What it is called on the report a person reads."
				bind:value={displayName}
				required
			/>
			<Input
				id="region-provider"
				name="provider"
				label="Runs on"
				hint="aws, gcp, azure, on-prem."
				bind:value={provider}
				required
			/>
			<div class="grid gap-4 sm:grid-cols-2">
				<Input
					id="region-lat"
					name="lat"
					label="Latitude"
					hint="Optional. Used to route a client to its nearest region."
					bind:value={lat}
				/>
				<Input id="region-long" name="long" label="Longitude" bind:value={long} />
			</div>

			<!-- Toggle renders a button, which submits nothing. -->
			<input type="hidden" name="enabled" value={enabled ? 'true' : 'false'} />
			<Toggle
				id="region-enabled"
				label="Accepting new tenants"
				hint="Turning this off closes the region to new tenants. Tenants already in it stay where they are."
				bind:checked={enabled}
			/>
			<input type="hidden" name="is_default" value={isDefault ? 'true' : 'false'} />
			<Toggle
				id="region-default"
				label="Default for new tenants"
				bind:checked={isDefault}
			/>
		</div>
	</form>
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (open = false)}>Cancel</Button>
		<Button variant="primary" type="submit" form="region-form" loading={saveRegionSubmit.pending}>
			{editing ? 'Save' : 'Create'}
		</Button>
	{/snippet}
</Drawer>
