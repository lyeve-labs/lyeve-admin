<script lang="ts">
	import PageTitle from '$lib/components/PageTitle.svelte';
	import { tracked } from '$lib/forms.svelte';
	import { crumbsAfter } from '$lib/breadcrumb';
	import { Alert, Badge, Breadcrumb, Button, Card, Collapsible, PageShell, SectionHeading, Table, Textarea } from '@lyeve-labs/ui-kit';
	import { enhance } from '$app/forms';
	import { History } from '@lucide/svelte';
	import type { ActionData, PageData } from './$types';
	import AiSection from '$lib/components/ai/AiSection.svelte';
	import { useCaseLabel } from '$lib/components/ai/use-case';
	import { formatDateTime } from '$lib/format';
	import { ICON } from '$lib/icon';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const back = { href: '/admin/ai/prompts', label: 'Prompts' };
	const p = $derived(data.prompt);
	// The editor starts from the text in force and is re-seeded after a save,
	// which the key on the form does.
	let body = $state('');
	$effect(() => {
		body = p?.active ?? '';
	});
	const dirty = $derived(!!p && body.trim() !== '' && body !== p.active);
	const nextVersion = $derived(p ? Math.max(0, ...p.versions.map((v) => v.version)) + 1 : 1);

	const save = tracked(() => async ({ update }) => update({ reset: false }));
</script>

<PageTitle title={p ? useCaseLabel(p.use_case) : 'Prompt'} />

<PageShell title={p ? useCaseLabel(p.use_case) : 'Prompt'} description={p ? `The system prompt for ${p.use_case}.` : ''} width="wide" {back}>
	{#snippet breadcrumb()}
		<Breadcrumb items={crumbsAfter(back, [{ label: 'AI', href: '/admin/ai' }, { label: 'Prompts', href: '/admin/ai/prompts' }, { label: p ? useCaseLabel(p.use_case) : 'Prompt' }])} />
	{/snippet}

	<AiSection tab="prompts" gate={data.gate} layoutGate={data.aiLayoutGate} noun="prompts">
		{#if p}
			<div class="flex flex-wrap items-center gap-2">
				{#if p.active_version === 0}
					<Badge tone="neutral">Shipped default in force</Badge>
				{:else}
					<Badge tone="brand">Version {p.active_version} in force</Badge>
				{/if}
				<span class="text-xs text-faint">{p.versions.length} saved {p.versions.length === 1 ? 'version' : 'versions'}</span>
			</div>

			<section class="flex flex-col gap-4">
				<SectionHeading level={2}>Edit</SectionHeading>
				<Card>
					{#key p.active_version}
						<form method="POST" action="?/save" use:enhance={save.enhance} class="flex flex-col gap-4">
							<Textarea
								id="prompt-body"
								name="body"
								label="System prompt"
								rows={10}
								bind:value={body}
								hint="Saving writes version {nextVersion}, which every call under this use case runs from then on. The guardrail below is appended to it and cannot be removed."
							/>
							{#if form?.scope === 'save' && form.error}
								<Alert tone="danger">{form.error}</Alert>
							{:else if form?.scope === 'save' && 'version' in form}
								<Alert tone="success" autoDismiss>Saved as version {form.version}.</Alert>
							{/if}
							<div class="flex justify-end">
								<Button variant="primary" type="submit" disabled={!dirty} loading={save.pending}>Save as version {nextVersion}</Button>
							</div>
						</form>
					{/key}
				</Card>
				<Collapsible label="Guardrail, always appended">
					<pre class="whitespace-pre-wrap rounded-md bg-surface-2 p-3 font-mono text-xs text-muted">{p.guardrail}</pre>
				</Collapsible>
			</section>

			<section class="flex flex-col gap-4">
				<SectionHeading level={2}>Versions</SectionHeading>
				{#if form?.scope === 'restore' && form.error}
					<Alert tone="danger">{form.error}</Alert>
				{:else if form?.scope === 'restore' && 'version' in form}
					<Alert tone="success" autoDismiss>Version {form.from} is current again, saved as version {form.version}.</Alert>
				{/if}
				<Table label="Versions">
					<thead>
						<tr>
							<th scope="col">Version</th>
							<th scope="col">Saved</th>
							<th scope="col">By</th>
							<th scope="col">Text</th>
							<th scope="col" class="text-right">Actions</th>
						</tr>
					</thead>
					<tbody>
						{#each p.versions as v (v.id)}
							<tr>
								<td data-cell="nowrap" class="font-medium">
									v{v.version}
									{#if v.version === p.active_version}<Badge tone="brand" size="sm" class="ms-2">current</Badge>{/if}
								</td>
								<td data-cell="nowrap" class="text-muted">{formatDateTime(v.created_at)}</td>
								<td data-cell="nowrap" class="text-muted">{v.created_by || 'unknown'}</td>
								<td>
									<Collapsible label="Show">
										<pre class="whitespace-pre-wrap font-mono text-xs text-muted">{v.body}</pre>
									</Collapsible>
								</td>
								<td class="text-right">
									{#if v.version !== p.active_version}
										<form method="POST" action="?/restore" use:enhance class="inline">
											<input type="hidden" name="version" value={v.version} />
											<Button variant="ghost" size="sm" type="submit" aria-label="Make version {v.version} current">
												<History size={ICON.sm} aria-hidden="true" />
											</Button>
										</form>
									{/if}
								</td>
							</tr>
						{/each}
						<tr>
							<td data-cell="nowrap" class="font-medium">
								v0
								{#if p.active_version === 0}<Badge tone="brand" size="sm" class="ms-2">current</Badge>{/if}
							</td>
							<td data-cell="nowrap" class="text-muted">shipped</td>
							<td data-cell="nowrap" class="text-muted">the plugin</td>
							<td>
								<Collapsible label="Show">
									<pre class="whitespace-pre-wrap font-mono text-xs text-muted">{p.default}</pre>
								</Collapsible>
							</td>
							<td class="text-right">
								{#if p.active_version !== 0}
									<form method="POST" action="?/restore" use:enhance class="inline">
										<input type="hidden" name="version" value="0" />
										<Button variant="ghost" size="sm" type="submit" aria-label="Make the shipped default current">
											<History size={ICON.sm} aria-hidden="true" />
										</Button>
									</form>
								{/if}
							</td>
						</tr>
					</tbody>
				</Table>
				<p class="text-xs text-faint">
					Making an older version current saves its text as a new version. The shipped default is version 0 and is
					never a row. Nothing here is deleted.
				</p>
			</section>
		{/if}
	</AiSection>
</PageShell>
