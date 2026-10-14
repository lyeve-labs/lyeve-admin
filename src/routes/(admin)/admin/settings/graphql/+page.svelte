<script lang="ts">
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
	import { tick } from 'svelte';
	import { submitter } from '$lib/forms.svelte';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import FormErrors from '$lib/components/FormErrors.svelte';
	import { GRAPHQL_HTTP, GRAPHQL_WS, type PersistedQuery, type RootField } from '$lib/api/graphql';
	import type { ActionData, PageData } from './$types';
	import { ICON } from '$lib/icon';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	/*
	 * The drawer and the row actions report through the one `form`, so each
	 * failure names the action that caused it. The drawer shows only a failed
	 * register, and only one that came back after it opened, so a failed delete
	 * never reads as a failure of the next form opened. The page shows the rest.
	 */
	const failure = $derived(form as { action?: string; error?: string } | null);
	let openedOver = $state.raw<unknown>(null);
	const registerError = $derived(failure?.action === 'register' && form !== openedOver ? (failure.error ?? '') : '');
	const formError = $derived(failure?.action === 'toggle' || failure?.action === 'delete' ? (failure.error ?? '') : '');

	function openRegister() {
		openedOver = form;
		open = true;
	}
	const curl = `curl -X POST ${GRAPHQL_HTTP} \\\n  -H 'Authorization: Bearer <token>' \\\n  -H 'Content-Type: application/json' \\\n  -d '{"query":"{ __typename }"}'`;

	let open = $state(false);
	const register = submitter(() => (open = false));

	let hash = $state('');
	let deleteForm = $state<HTMLFormElement>();
	let toggleForm = $state<HTMLFormElement>();

	async function askDelete(q: PersistedQuery) {
		const ok = await confirm(
			`Delete persisted query ${q.operation_name || q.query_hash.slice(0, 12)}`,
			'A client that sends only its hash is refused from then on.',
			{ confirmLabel: 'Delete' },
		);
		if (!ok) return;
		hash = q.query_hash;
		await tick();
		deleteForm?.requestSubmit();
	}

	async function toggle(q: PersistedQuery) {
		hash = q.query_hash;
		await tick();
		toggleForm?.requestSubmit();
	}

	const schemaRoots = $derived(data.schema.ok ? data.schema.value.roots : null);
	const refused = $derived(data.schema.ok ? data.schema.value.refused : null);
	const persisted = $derived(data.persisted.ok ? data.persisted.value : []);
	const roots = $derived(
		schemaRoots
			? ([
					['Queries', schemaRoots.query],
					['Mutations', schemaRoots.mutation],
					['Subscriptions', schemaRoots.subscription],
				] as [string, RootField[]][])
			: [],
	);
</script>

<PageShell
	title="GraphQL"
	documentTitle="GraphQL - Settings"
	description="The schema this instance generates from your content types, where it answers, and the queries it allows by hash."
	width="wide"
>
	{#snippet actions()}
		<Button variant="secondary" size="sm" href="/admin/api-labs">
			<FlaskConical size={ICON.sm} /> Try it in API labs
		</Button>
	{/snippet}

	{#if formError}
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
			{#if !data.schema.ok}
				<GateNotice gate={data.schema.gate} title="GraphQL schema" absent="This version of the GraphQL plugin does not describe its schema." />
			{:else if refused}
				<Alert tone="warn">
					The engine refused to describe its schema: {refused} The graphql.introspection setting limits
					introspection to admins by default and can turn it off. The schema is served either way.
				</Alert>
			{:else if !schemaRoots}
				<Alert tone="danger">The schema could not be read. This is not a report that it is empty.</Alert>
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
													<!-- The table breaks a narrow column anywhere, which split
													     names mid-word. Each identifier is held whole, so a long
													     argument list breaks only between arguments. -->
													<td class="font-mono text-xs text-fg">
														<span class="whitespace-nowrap">{f.name}</span>{#each f.args as arg, i (arg)}{#if i > 0}{' '}{/if}<span
																class="whitespace-nowrap text-faint"
																>{i === 0 ? '(' : ''}{arg}{i === f.args.length - 1 ? ')' : ','}</span
															>{/each}
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
				{#if data.persisted.ok}
					<Button variant="secondary" size="sm" onclick={openRegister}>
						<Plus size={ICON.sm} /> New persisted query
					</Button>
				{/if}
			</div>
			<p class="text-xs text-muted">
				A client sends the hash of a query instead of its text. Queries on this list answer by hash. One a client
				registered itself is marked automatic, and a disabled one is refused until it is switched back on.
			</p>
			{#if !data.persisted.ok}
				<GateNotice gate={data.persisted.gate} title="Persisted queries" absent="This version of the GraphQL plugin keeps no persisted queries." />
			{:else if persisted.length === 0}
				<EmptyState title="No persisted queries" description="Register a query to let clients call it by hash.">
					{#snippet iconSnippet()}<Braces size={ICON.lg} />{/snippet}
					{#snippet action()}
						<Button variant="secondary" onclick={openRegister}>
							<Plus size={ICON.sm} /> New persisted query
						</Button>
					{/snippet}
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
						{#each persisted as q (q.query_hash)}
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
		<FormErrors message={registerError || undefined} />
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
