<script lang="ts">
	import PageTitle from '$lib/components/PageTitle.svelte';
	import { Button, PageShell } from '@lyeve-labs/ui-kit';
	import { Pencil } from '@lucide/svelte';
	import CustomBlocks from '$lib/components/custom/CustomBlocks.svelte';
	import { ICON } from '$lib/icon';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const canEdit = $derived(data.user.roles.includes('admin') || data.user.roles.includes('super_admin'));
</script>

<PageTitle title={data.customPage.title} />

<PageShell title={data.customPage.title} description={data.customPage.description || undefined} width="wide">
	{#snippet actions()}
		{#if canEdit}
			<Button variant="secondary" size="sm" href="/admin/settings/customization/pages/{data.customPage.slug}">
				<Pencil size={ICON.sm} /> Edit page
			</Button>
		{/if}
	{/snippet}
	{#if data.blocks.length === 0}
		<p class="text-sm text-muted">This page has no blocks yet.</p>
	{:else}
		<CustomBlocks blocks={data.blocks} roles={data.user.roles} />
	{/if}
</PageShell>
