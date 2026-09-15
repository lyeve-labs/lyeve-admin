<script lang="ts">
	import PageTitle from '$lib/components/PageTitle.svelte';
	import { Badge, Button, EmptyState, PageShell, Table } from '@lyeve-labs/ui-kit';
	import { ChevronRight, MessageSquareText } from '@lucide/svelte';
	import type { PageData } from './$types';
	import AiSection from '$lib/components/ai/AiSection.svelte';
	import { useCaseLabel } from '$lib/components/ai/use-case';
	import { formatDateTime } from '$lib/format';
	import { ICON } from '$lib/icon';

	let { data }: { data: PageData } = $props();
</script>

<PageTitle title="AI prompts" />

<PageShell
	title="AI prompts"
	description="One system prompt per use case. The shipped text is version 0. Every save is a new version and a transcript records the one it ran under."
	width="wide"
>
	<AiSection tab="prompts" gate={data.gate} layoutGate={data.aiLayoutGate} noun="prompts">
		{#if data.prompts.length === 0}
			<EmptyState title="No use cases" description="The plugin listed no prompt use cases. This is not a state a mounted plugin answers with.">
				{#snippet iconSnippet()}
					<MessageSquareText size={ICON.lg} />
				{/snippet}
			</EmptyState>
		{:else}
			<Table label="Prompts">
				<thead>
					<tr>
						<th scope="col">Use case</th>
						<th scope="col">Current</th>
						<th scope="col">Saved versions</th>
						<th scope="col">Last saved</th>
						<th scope="col" class="text-right">Actions</th>
					</tr>
				</thead>
				<tbody>
					{#each data.prompts as p (p.use_case)}
						{@const latest = p.versions[0]}
						<tr>
							<td data-cell="nowrap" class="font-medium">
								{useCaseLabel(p.use_case)}
								<span class="block text-xs text-faint">{p.use_case}</span>
							</td>
							<td>
								{#if p.active_version === 0}
									<Badge tone="neutral">Shipped default</Badge>
								{:else}
									<Badge tone="brand">Version {p.active_version}</Badge>
								{/if}
							</td>
							<td data-cell="nowrap" class="text-muted">{p.versions.length}</td>
							<td data-cell="nowrap" class="text-muted">{latest ? formatDateTime(latest.created_at) : 'never'}</td>
							<td class="text-right">
								<Button href="/admin/ai/prompts/{p.use_case}" variant="ghost" size="sm">
									Manage <ChevronRight size={ICON.sm} aria-hidden="true" />
								</Button>
							</td>
						</tr>
					{/each}
				</tbody>
			</Table>
		{/if}
	</AiSection>
</PageShell>
