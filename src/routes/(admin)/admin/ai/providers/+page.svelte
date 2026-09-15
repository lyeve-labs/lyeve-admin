<script lang="ts">
	import PageTitle from '$lib/components/PageTitle.svelte';
	import { Alert, Badge, Button, Drawer, EmptyState, PageShell, Pagination, Stat, Table } from '@lyeve-labs/ui-kit';
	import { enhance } from '$app/forms';
	import { submitter } from '$lib/forms.svelte';
	import { ChevronRight, Plus, Server } from '@lucide/svelte';
	import type { ActionData, PageData } from './$types';
	import AiSection from '$lib/components/ai/AiSection.svelte';
	import ProviderForm from '$lib/components/ai/ProviderForm.svelte';
	import { effectiveGate, providerKindLabel } from '$lib/api/ai';
	import { formatCount } from '$lib/format';
	import { pageHref, pageNumber } from '$lib/api/list';
	import { ICON } from '$lib/icon';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let open = $state(false);
	const canWrite = $derived(data.isSuperAdmin && effectiveGate(data.gate, data.aiLayoutGate).state === 'ok');

	const create = submitter(() => (open = false));
</script>

<PageTitle title="AI providers" />

<PageShell title="AI providers" description="The models this tenant may call, and the keys they are called with." width="wide">
	{#snippet actions()}
		{#if canWrite}
			<Button variant="primary" size="sm" onclick={() => (open = true)}>
				<Plus size={ICON.sm} aria-hidden="true" /> New provider
			</Button>
		{/if}
	{/snippet}

	<AiSection tab="providers" gate={data.gate} layoutGate={data.aiLayoutGate} noun="providers">
		{#if data.dashboard}
			<div class="grid grid-cols-2 gap-4 md:grid-cols-4">
				<Stat size="sm" mono label="Providers" value="{data.dashboard.enabled_providers}/{data.dashboard.total_providers}" sub="enabled" />
				<Stat size="sm" mono label="Calls" value={formatCount(data.dashboard.total_calls)} />
				<Stat size="sm" mono label="Average latency" value="{Math.round(data.dashboard.avg_latency_ms)} ms" />
				<Stat size="sm" mono label="Cost" value="${data.dashboard.total_cost}" />
			</div>
		{/if}

		{#if data.providers.length === 0}
			<EmptyState
				title="No providers yet"
				description={data.isSuperAdmin
					? 'Nothing is sent anywhere until a provider is added. Add one with your own key or point at a server on your network.'
					: 'Nothing is sent anywhere until a super admin adds a provider.'}
			>
				{#snippet iconSnippet()}
					<Server size={ICON.lg} />
				{/snippet}
				{#snippet action()}
					{#if data.isSuperAdmin}
						<Button variant="secondary" onclick={() => (open = true)}>
							<Plus size={ICON.sm} aria-hidden="true" /> New provider
						</Button>
					{/if}
				{/snippet}
			</EmptyState>
		{:else}
			<Table label="Providers">
				<thead>
					<tr>
						<th scope="col">Name</th>
						<th scope="col">Kind</th>
						<th scope="col">Priority</th>
						<th scope="col">Modalities</th>
						<th scope="col">Key</th>
						<th scope="col">Status</th>
						<th scope="col" class="text-right">Actions</th>
					</tr>
				</thead>
				<tbody>
					{#each data.providers as p (p.id)}
						<tr>
							<td data-cell="nowrap" class="font-medium">
								{p.name}
								{#if p.base_url}<span class="block text-xs text-faint">{p.base_url}</span>{/if}
							</td>
							<td><Badge tone="violet">{providerKindLabel(p.kind)}</Badge></td>
							<td data-cell="nowrap" class="text-muted">{p.priority}</td>
							<td data-cell="nowrap">
								<span class="flex flex-wrap gap-1">
									{#each p.modalities as m (m)}
										<Badge tone="neutral" size="sm">{m}</Badge>
									{/each}
									{#if p.modalities.length === 0}<span class="text-xs text-faint">none</span>{/if}
								</span>
							</td>
							<td data-cell="nowrap">
								{#if p.needs_key}
									<Badge tone="warn" dot>Needs key</Badge>
								{:else if p.has_key}
									<Badge tone="success" dot>Stored</Badge>
								{:else}
									<span class="text-xs text-faint">none</span>
								{/if}
							</td>
							<td>
								{#if p.enabled}
									<Badge tone="success" dot>Enabled</Badge>
								{:else}
									<Badge tone="neutral" dot>Disabled</Badge>
								{/if}
							</td>
							<td class="text-right">
								<Button href="/admin/ai/providers/{p.id}" variant="ghost" size="sm">
									{data.isSuperAdmin ? 'Manage' : 'View'} <ChevronRight size={ICON.sm} aria-hidden="true" />
								</Button>
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
				href={pageHref('/admin/ai/providers', data.limit)}
			/>
		{/if}
	</AiSection>
</PageShell>

{#if data.isSuperAdmin}
	<Drawer bind:open title="New provider" description="A key is encrypted at rest and never shown again." onclose={() => (open = false)}>
		<form id="provider-create" method="POST" action="?/create" use:enhance={create.enhance} class="flex flex-col gap-4">
			<ProviderForm id="new" superAdmin={data.isSuperAdmin} />
			{#if form?.error}
				<Alert tone="danger">{form.error}</Alert>
			{/if}
		</form>
		{#snippet footer()}
			<Button variant="secondary" onclick={() => (open = false)}>Cancel</Button>
			<Button variant="primary" type="submit" form="provider-create" loading={create.pending}>Create</Button>
		{/snippet}
	</Drawer>
{/if}
