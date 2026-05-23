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
		SectionHeading,
		Table,
		Textarea,
		confirm,
	} from '@lyeve-labs/ui-kit';
	import { Braces, FlaskConical, Plus, Power, Trash2 } from '@lucide/svelte';
	import { enhance } from '$app/forms';
	import { submitter } from '$lib/forms.svelte';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import { GRAPHQL_HTTP, GRAPHQL_WS, type PersistedQuery, type RootField } from '$lib/api/graphql';
	import type { ActionData, PageData } from './$types';
	import { ICON } from '$lib/icon';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const formError = $derived((form as { error?: string } | null)?.error ?? '');
	const curl = `curl -X POST ${GRAPHQL_HTTP} \\\n  -H 'Authorization: Bearer <token>' \\\n  -H 'Content-Type: application/json' \\\n  -d '{"query":"{ __typename }"}'`;

	let open = $state(false);
	const register = submitter(() => (open = false));

	let hash = $state('');
	let deleteForm = $state<HTMLFormElement>();
	let toggleForm = $state<HTMLFormElement>();

	async function askDelete(q: PersistedQuery) {
		const ok = await confirm(
			'Delete persisted query',
			`Delete ${q.operation_name || q.query_hash.slice(0, 12)}? A client that sends only its hash is refused from then on.`,
			{ confirmLabel: 'Delete' },
		);
		if (!ok) return;
		hash = q.query_hash;
		await Promise.resolve();
		deleteForm?.requestSubmit();
	}

	async function toggle(q: PersistedQuery) {
		hash = q.query_hash;
		await Promise.resolve();
		toggleForm?.requestSubmit();
	}

	const roots = $derived(
		data.roots
			? ([
					['Queries', data.roots.query],
					['Mutations', data.roots.mutation],
					['Subscriptions', data.roots.subscription],
				] as [string, RootField[]][])
			: [],
	);
</script>

<PageTitle title="GraphQL - Settings" />

<PageShell
	title="GraphQL"
	description="The schema this instance generates from your content types, where it answers, and the queries it allows by hash."
	width="wide"
>
	{#snippet actions()}
		<Button variant="secondary" size="sm" href="/admin/api-labs">
			<FlaskConical size={ICON.sm} /> Try it in API labs
		</Button>
	{/snippet}

	{#if formError && !open}
		<Alert tone="danger">{formError}</Alert>
	{/if}

	{#if data.gate.state !== 'ok'}
		<GateNotice
			gate={data.gate}
			title="GraphQL"
			absent="The GraphQL plugin is not part of this build, so nothing answers on these paths."
		/>
	{:else}
		<section class="flex flex-col gap-3">
			<SectionHeading level={2}>Where it answers</SectionHeading>
			<Table label="GraphQL endpoints">
				<tbody>
					<tr>
						<th scope="row" class="text-sm">Queries and mutations</th>
						<td class="font-mono text-xs">POST {GRAPHQL_HTTP}</td>
						<td class="text-xs text-muted">A GET on the same path answers only that the endpoint is ready.</td>
					</tr>
					<tr>
						<th scope="row" class="text-sm">Subscriptions</th>
						<td class="font-mono text-xs">GET {GRAPHQL_WS}</td>
						<td class="text-xs text-muted">WebSocket, the graphql-ws protocol: send the token in connection_init.</td>
					</tr>
				</tbody>
			</Table>
			<p class="text-xs text-muted">
				Both take the same credentials as the REST API: a bearer token or an API key. A client that sends a
				persisted query's hash instead of its text needs it on the list below.
			</p>
			<div class="flex flex-col gap-2">
				<div class="flex items-center justify-between gap-2">
					<span class="text-xs text-muted">A first request</span>
					<CopyButton value={curl} label="Copy the request" />
				</div>
				<pre class="overflow-auto rounded border border-line bg-surface-2 p-3 font-mono text-xs">{curl}</pre>
			</div>
		</section>

		<section class="flex flex-col gap-3">
			<SectionHeading level={2}>Schema</SectionHeading>
			{#if data.refused}
				<Alert tone="warn">
					The engine refused to describe its schema: {data.refused} The graphql.introspection setting limits
					introspection to admins by default and can turn it off. The schema is served either way.
				</Alert>
			{:else if !data.roots}
				<Alert tone="danger">The schema could not be read.</Alert>
			{:else}
				<p class="text-xs text-muted">
					Generated from the content types, so a schema you add in the Schema builder appears here as its own
					fields.
				</p>
				<div class="grid gap-4 lg:grid-cols-3">
					{#each roots as [label, fields] (label)}
						<div class="flex flex-col gap-2">
							<SectionHeading level={3}>{label} <Badge tone="neutral" size="sm">{fields.length}</Badge></SectionHeading>
							{#if fields.length === 0}
								<p class="text-sm text-faint">None.</p>
							{:else}
								<div class="max-h-96 overflow-auto rounded border border-line">
									<Table label={label}>
										<tbody>
											{#each fields as f (f.name)}
												<tr>
													<td class="font-mono text-xs text-fg">
														{f.name}{#if f.args.length}<span class="text-faint">({f.args.join(', ')})</span>{/if}
													</td>
													<td class="text-xs text-muted">{f.description}</td>
												</tr>
											{/each}
										</tbody>
									</Table>
								</div>
							{/if}
						</div>
					{/each}
				</div>
			{/if}
		</section>

		<section class="flex flex-col gap-3">
			<div class="flex items-center justify-between gap-2">
				<SectionHeading level={2}>Persisted queries</SectionHeading>
				<Button variant="secondary" size="sm" onclick={() => (open = true)}>
					<Plus size={ICON.sm} /> New persisted query
				</Button>
			</div>
			<p class="text-xs text-muted">
				A client sends the hash of a query instead of its text. Queries on this list answer by hash. One a client
				registered itself is marked automatic, and a disabled one is refused until it is switched back on.
			</p>
			{#if data.persistedError}
				<Alert tone="danger">{data.persistedError}</Alert>
			{:else if data.persisted.length === 0}
				<EmptyState title="No persisted queries" description="Register a query to let clients call it by hash.">
					{#snippet iconSnippet()}<Braces size={ICON.lg} />{/snippet}
				</EmptyState>
			{:else}
				<Table label="Persisted queries">
					<thead>
						<tr>
							<th scope="col">Operation</th>
							<th scope="col">Hash</th>
							<th scope="col">Query</th>
							<th scope="col">Actions</th>
						</tr>
					</thead>
					<tbody>
						{#each data.persisted as q (q.query_hash)}
							<tr>
								<td data-cell="nowrap">
									<span class="flex items-center gap-2 text-sm text-fg">
										{q.operation_name || 'unnamed'}
										{#if !q.enabled}<Badge tone="neutral" size="sm">off</Badge>{/if}
										{#if q.auto_registered}<Badge tone="brand" size="sm">automatic</Badge>{/if}
									</span>
									{#if q.description}<span class="block text-xs text-muted">{q.description}</span>{/if}
								</td>
								<td data-cell="nowrap" class="font-mono text-xs text-faint">{q.query_hash.slice(0, 16)}</td>
								<td class="max-w-md truncate font-mono text-xs text-muted">{q.query}</td>
								<td>
									<div class="flex items-center gap-2">
										<CopyButton value={q.query_hash} label="Copy the hash of {q.operation_name || 'this query'}" />
										<Button
											variant="ghost"
											size="sm"
											onclick={() => toggle(q)}
											aria-label="{q.enabled ? 'Disable' : 'Enable'} {q.operation_name || q.query_hash.slice(0, 12)}"
										>
											<Power size={ICON.sm} />
										</Button>
										<Button
											variant="ghost"
											size="sm"
											onclick={() => askDelete(q)}
											aria-label="Delete {q.operation_name || q.query_hash.slice(0, 12)}"
										>
											<Trash2 size={ICON.sm} class="text-danger" />
										</Button>
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

<Drawer bind:open title="New persisted query">
	<form method="POST" action="?/register" id="persisted-form" use:enhance={register.enhance} class="flex flex-col gap-4">
		{#if formError}
			<Alert tone="danger">{formError}</Alert>
		{/if}
		<Textarea
			id="persisted-query"
			name="query"
			label="Query"
			required
			mono
			rows={10}
			placeholder={'query Posts {\n  posts { id title }\n}'}
			hint="Its SHA-256 is the hash a client sends."
		/>
		<Input id="persisted-operation" name="operation_name" label="Operation name" mono placeholder="Posts" />
		<Input id="persisted-description" name="description" label="Description" placeholder="The home page's post list" />
	</form>
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (open = false)}>Cancel</Button>
		<Button variant="primary" type="submit" form="persisted-form" loading={register.pending}>Create</Button>
	{/snippet}
</Drawer>

<form method="POST" action="?/delete" use:enhance bind:this={deleteForm} class="hidden">
	<input type="hidden" name="hash" value={hash} />
</form>
<form method="POST" action="?/toggle" use:enhance bind:this={toggleForm} class="hidden">
	<input type="hidden" name="hash" value={hash} />
</form>
