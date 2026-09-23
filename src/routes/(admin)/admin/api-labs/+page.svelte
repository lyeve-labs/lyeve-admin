<script lang="ts">
	import PageTitle from '$lib/components/PageTitle.svelte';
	import {
		Alert,
		Badge,
		Button,
		CopyButton,
		EmptyState,
		Input,
		PageShell,
		SearchInput,
		SectionHeading,
		SegmentedControl,
		Select,
		Table,
		Textarea,
		confirm as confirmDialog,
	} from '@lyeve-labs/ui-kit';
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { Network, Play, Terminal } from '@lucide/svelte';
	import {
		GRAPHQL_URL,
		RISK_LABELS,
		documentedStatus,
		graphqlMutates,
		grpcRouteParams,
		grpcRouteTakesBody,
		pathParams,
		riskOf,
		riskTone,
		statusHint,
		statusTone,
		type LabEndpoint,
		type LabResult,
	} from '$lib/api/labs';
	import type { ActionData, PageData } from './$types';
	import { ICON } from '$lib/icon';
	import StreamLab from '$lib/components/labs/StreamLab.svelte';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const formError = $derived((form as { error?: string } | null)?.error ?? '');
	const restResult = $derived((form as { rest?: LabResult } | null)?.rest ?? null);
	const gqlResult = $derived((form as { graphql?: LabResult } | null)?.graphql ?? null);
	const gqlMutated = $derived((form as { mutated?: boolean } | null)?.mutated ?? false);
	const grpcResult = $derived((form as { grpc?: LabResult } | null)?.grpc ?? null);

	// Opens on the protocol whose answer is in hand, so a submit that did not
	// run the enhancer still shows its result instead of returning to REST.
	// Seeded once on purpose: derived, it would drag the reader back every
	// time an answer arrived, which is the opposite of what a tab is for.
	// svelte-ignore state_referenced_locally
	let tab = $state(
		(form as { graphql?: unknown } | null)?.graphql
			? 'graphql'
			: (form as { grpc?: unknown } | null)?.grpc
				? 'grpc'
				: 'rest',
	);
	let narrow = $state('');
	let sending = $state(false);

	let grpcRoute = $state('');
	let grpcValues = $state<Record<string, string>>({});
	const grpcParams = $derived(grpcRoute ? grpcRouteParams(grpcRoute) : []);
	const grpcWrites = $derived(grpcRoute ? grpcRouteTakesBody(grpcRoute) : false);
	// Each parameter box binds to its key, and a missing key is undefined,
	// which the kit's Input refuses. Seed the keys a route brings before its
	// boxes render.
	$effect.pre(() => {
		for (const n of grpcParams) if (grpcValues[n] === undefined) grpcValues[n] = '';
	});

	const visible = $derived(
		narrow.trim()
			? data.endpoints.filter((e) =>
					`${e.method} ${e.path} ${e.summary}`.toLowerCase().includes(narrow.trim().toLowerCase()),
				)
			: data.endpoints,
	);

	let selectedId = $state('');
	const selected = $derived<LabEndpoint | null>(
		data.endpoints.find((e) => e.id === selectedId) ?? null,
	);
	const selectedRisk = $derived(selected ? riskOf(selected.method) : 'read');
	// The answer is compared with the route it was sent to, which is the one
	// named in the result, not whichever row is selected now.
	const expectedFor = $derived(
		restResult ? (data.endpoints.find((e) => e.method === restResult.method && samePath(e.path, restResult.path)) ?? null) : null,
	);
	function samePath(template: string, sent: string): boolean {
		const want = template.split('/');
		const got = sent.split('?')[0].split('/');
		return want.length === got.length && want.every((seg, k) => (seg.startsWith('{') && seg.endsWith('}') ? got[k] !== '' : seg === got[k]));
	}

	let body = $state('');
	let document = $state('query {\n  \n}');
	let variables = $state('');

	function choose(e: LabEndpoint) {
		selectedId = e.id;
		body = e.requestBody?.example ?? '';
	}

	/**
	 * A send that changes something asks first and names what it will hit.
	 * A tester pointed at a real instance is one click from deleting a row
	 * they meant to read.
	 */
	const sendRest: SubmitFunction = async ({ cancel }) => {
		if (!selected) {
			cancel();
			return;
		}
		if (selectedRisk !== 'read') {
			const verb = selectedRisk === 'destructive' ? 'delete from' : 'write to';
			const ok = await confirmDialog(
				`Send ${selected.method} ${selected.path}?`,
				`This will ${verb} the instance you are signed in to, as you. Nothing here is a rehearsal.`,
				{ confirmLabel: 'Send it' },
			);
			if (!ok) {
				cancel();
				return;
			}
		}
		sending = true;
		return async ({ update }) => {
			await update({ reset: false });
			sending = false;
		};
	};

	const sendGrpc: SubmitFunction = async ({ cancel }) => {
		if (grpcWrites || grpcRoute.startsWith('DELETE ')) {
			const ok = await confirmDialog(
				'Run this call?',
				'It goes to the transcoding listener as you, and it writes.',
				{ confirmLabel: 'Run it' },
			);
			if (!ok) {
				cancel();
				return;
			}
		}
		sending = true;
		return async ({ update }) => {
			await update({ reset: false });
			sending = false;
		};
	};

	const sendGraphql: SubmitFunction = async ({ cancel }) => {
		if (graphqlMutates(document)) {
			const ok = await confirmDialog(
				'Send this mutation?',
				'It writes to the instance you are signed in to, as you.',
				{ confirmLabel: 'Send it' },
			);
			if (!ok) {
				cancel();
				return;
			}
		}
		sending = true;
		return async ({ update }) => {
			await update({ reset: false });
			sending = false;
		};
	};
</script>

<PageTitle title="API labs" />

{#snippet answer(result: LabResult)}
	<SectionHeading level={3}>The answer</SectionHeading>
	<div class="flex flex-wrap items-center gap-2">
		<Badge tone={statusTone(result.status)} dot>
			{result.status}
			{result.statusText}
		</Badge>
		<span class="font-mono text-xs text-faint">{result.method} {result.path}</span>
		<span class="text-xs text-faint">{result.durationMs} ms</span>
	</div>
	{#if expectedFor}
		{@const doc = documentedStatus(expectedFor.statuses, result.status)}
		{#if doc}
			<p class="text-xs text-muted">Documented: {doc.code} {doc.description}</p>
		{:else if doc === false}
			<p class="text-xs text-warn">
				{result.status} is not one of the statuses the document lists for this route
				({expectedFor.statuses?.map((x) => x.code).join(', ')}).
			</p>
		{/if}
	{/if}
	{#if statusHint(result.status)}
		<!-- The statuses a tester meets once and has to guess at. 402 is the
		     one worth spelling out: nothing about the request is wrong. -->
		<Alert tone={statusTone(result.status) === 'success' ? 'brand' : 'warn'}>
			{statusHint(result.status)}
		</Alert>
	{/if}
	{#if Object.keys(result.headers).length > 0}
		<Table label="The answer">
			<tbody>
				{#each Object.entries(result.headers) as [name, value] (name)}
					<tr>
						<th scope="row" class="font-mono text-xs">{name}</th>
						<td class="font-mono text-xs text-faint">{value}</td>
					</tr>
				{/each}
			</tbody>
		</Table>
	{/if}
	<div class="flex items-center justify-between gap-2">
		<span class="text-xs text-muted">{result.json ? 'JSON' : 'Not JSON'}</span>
		<CopyButton value={result.body} label="Copy the response" />
	</div>
	<pre class="max-h-96 overflow-auto rounded border border-line bg-surface-2 p-3 font-mono text-xs">{result.body ||
			'(empty body)'}</pre>
{/snippet}

<PageShell
	title="API labs"
	description="Send a real request to this instance and read what it answers."
	width="wide"
>
	<!-- The one thing a tester has to understand before the first send. -->
	<Alert tone="warn">
		Every request goes to the instance you are signed in to, as you. There is no sandbox here
		and nothing is replayed against a copy: a write writes, and a delete deletes.
	</Alert>

	{#if data.source === 'catalog'}
		<Alert tone="danger">
			The engine did not answer with its API document, so this list is the built-in catalog
			rather than what this build actually serves. An endpoint missing here may still exist.
		</Alert>
	{/if}

	{#if formError}
		<Alert tone="danger">{formError}</Alert>
	{/if}

	<SegmentedControl
		label="Which protocol to send"
		bind:value={tab}
		options={[
			{ value: 'rest', label: 'REST' },
			{ value: 'graphql', label: 'GraphQL' },
			{ value: 'grpc', label: 'gRPC' },
			{ value: 'stream', label: 'Streams' },
		]}
	/>

	{#if tab === 'rest'}
		<section class="flex flex-col gap-4">
			<SectionHeading level={2}>Pick an endpoint</SectionHeading>
			<SearchInput bind:value={narrow} placeholder="Search {data.endpoints.length} endpoints" />

			{#if visible.length === 0}
				<EmptyState title="No endpoint matches" description="Nothing here is named or pathed that way.">
					{#snippet iconSnippet()}
						<Terminal size={ICON.lg} />
					{/snippet}
				</EmptyState>
			{:else}
				<div class="max-h-72 overflow-auto rounded border border-line">
					<Table label="Pick an endpoint">
						<tbody>
							{#each visible.slice(0, 200) as e (e.id)}
								<tr>
									<td data-cell="nowrap">
										<Badge tone={riskTone(riskOf(e.method))}>{e.method}</Badge>
									</td>
									<td class="font-mono text-xs">{e.path}</td>
									<td class="max-w-sm truncate text-xs text-faint">{e.summary}</td>
									<td data-cell="nowrap">
										<Button
											variant={selectedId === e.id ? 'primary' : 'ghost'}
											size="sm"
											onclick={() => choose(e)}
										>
											{selectedId === e.id ? 'Selected' : 'Select'}
										</Button>
									</td>
								</tr>
							{/each}
						</tbody>
					</Table>
				</div>
				{#if visible.length > 200}
					<p class="text-xs text-faint">
						Showing the first 200 of {visible.length}. Narrow the search to reach the rest.
					</p>
				{/if}
			{/if}
		</section>

		{#if selected}
			<section class="flex flex-col gap-4">
				<SectionHeading level={2}>{selected.method} {selected.path}</SectionHeading>
				<div class="flex items-center gap-2">
					<Badge tone={riskTone(selectedRisk)} dot>{RISK_LABELS[selectedRisk]}</Badge>
					<span class="text-xs text-faint">{selected.groupLabel}</span>
				</div>

				{#if selected.statuses?.length || selected.response}
					<div class="flex flex-col gap-2">
						<SectionHeading level={3}>What it answers</SectionHeading>
						{#if selected.statuses?.length}
							<div class="flex flex-wrap gap-2">
								{#each selected.statuses as st (st.code)}
									<Badge tone={statusTone(Number(st.code) || 0)}>{st.code} {st.description}</Badge>
								{/each}
							</div>
						{/if}
						{#if selected.response}
							<p class="text-xs text-muted">{selected.response.description}</p>
							<pre class="max-h-64 overflow-auto rounded border border-line bg-surface-2 p-3 font-mono text-xs">{selected.response.example}</pre>
						{/if}
					</div>
				{/if}

				<form method="POST" action="?/rest" use:enhance={sendRest}>
					<input type="hidden" name="endpoint" value={selected.id} />
					<div class="flex flex-col gap-4">
						{#each pathParams(selected) as name (name)}
							<Input
								id="lab-path-{name}"
								name="p_{name}"
								label="{name} (in the path)"
								hint="Required. The path is sent with this value in place of the placeholder."
								required
							/>
						{/each}
						{#each (selected.params ?? []).filter((p) => p.in === 'query') as p (p.name)}
							<Input
								id="lab-query-{p.name}"
								name="p_{p.name}"
								label="{p.name} (query)"
								hint={p.description || (p.values ? `One of: ${p.values.join(', ')}` : '')}
							/>
						{/each}
						{#if selected.method !== 'GET'}
							<Textarea
								id="lab-body"
								name="body"
								label="Request body"
								hint="JSON. Left empty, nothing is sent as a body."
								rows={8}
								bind:value={body}
							/>
						{/if}
					</div>
					<div class="mt-4">
						<Button variant="primary" type="submit" loading={sending}>
							<Play size={ICON.sm} /> Send
						</Button>
					</div>
				</form>
			</section>

		{/if}

		{#if restResult}
			{@render answer(restResult)}
		{/if}
	{:else if tab === 'graphql'}
		<section class="flex flex-col gap-4">
			<SectionHeading level={2}>GraphQL</SectionHeading>
			<p class="text-xs text-muted">
				Posted to <span class="font-mono">{GRAPHQL_URL}</span>. The schema is generated from your
				content types, so the fields here are the ones the schema builder made.
			</p>

			<form method="POST" action="?/graphql" use:enhance={sendGraphql}>
				<div class="flex flex-col gap-4">
					<Textarea
						id="lab-document"
						name="document"
						label="Query or mutation"
						rows={10}
						bind:value={document}
						required
					/>
					<Textarea
						id="lab-variables"
						name="variables"
						label="Variables"
						hint="A JSON object, or empty. Anything else is refused before it is sent."
						rows={4}
						bind:value={variables}
					/>
				</div>
				<div class="mt-4 flex items-center gap-3">
					<Button variant="primary" type="submit" loading={sending}>
						<Play size={ICON.sm} /> Send
					</Button>
					{#if graphqlMutates(document)}
						<Badge tone="warn" dot>This document mutates</Badge>
					{/if}
				</div>
			</form>

			{#if gqlResult}
				{#if gqlResult.status === 200 && gqlResult.body.includes('"errors"')}
					<!-- GraphQL answers 200 and puts the failure in the body, so a
					     status badge alone reads as success. -->
					<Alert tone="warn">
						The status is 200 and the body carries an `errors` array. GraphQL reports failures
						inside a successful response, so read the body rather than the status.
					</Alert>
				{/if}
				{#if gqlMutated}
					<Alert tone="brand">That was a mutation, so anything it changed is changed.</Alert>
				{/if}
				{@render answer(gqlResult)}
			{/if}
		</section>
	{:else if tab === 'grpc'}
		<section class="flex flex-col gap-4">
			<SectionHeading level={2}>gRPC</SectionHeading>
			{#if !data.grpc.reachable}
				<Alert tone="brand">
					The gRPC plugin is not part of this build, or the instance does not enable it, so there
					is no listener to call.
				</Alert>
			{:else if !data.grpc.listening}
				<Alert tone="danger">
					The plugin is present and nothing is listening. The gRPC screen says why.
				</Alert>
			{:else}
				<!-- Sent, not fetched. The engine's invoke route runs the call
				     inside the plugin, against the mux it built, so nothing here
				     addresses a host and the listener's own JWT check still
				     decides the answer. -->
				<Alert tone="brand">
					These paths are served by the gRPC plugin's own listener. The engine runs the call
					inside the plugin rather than reaching across to it, and the listener authenticates
					it against your token exactly as it would a direct caller.
				</Alert>
				<form method="POST" action="?/grpc" use:enhance={sendGrpc}>
					<div class="grid gap-4">
						<Select
							name="route"
							label="Transcoded route"
							bind:value={grpcRoute}
							options={data.grpc.routes.map((r) => ({ value: r, label: r }))}
							placeholder="Pick a route"
						/>
						{#if grpcParams.length > 0}
							<div class="grid gap-4 sm:grid-cols-2">
								{#each grpcParams as name (name)}
									<Input
										name="g_{name}"
										label={name}
										bind:value={grpcValues[name]}
										placeholder="Required"
									/>
								{/each}
							</div>
						{/if}
						{#if grpcWrites}
							<Textarea name="body" label="Body" rows={8} placeholder={'{\n  "title": "Hello"\n}'} />
						{/if}
						<div class="flex items-center gap-3">
							<Button variant="primary" type="submit" loading={sending} disabled={!grpcRoute}>
								<Play size={ICON.sm} /> Run
							</Button>
							{#if grpcRoute}
								<CopyButton value={grpcRoute} label="Copy {grpcRoute}" />
							{/if}
						</div>
					</div>
				</form>
				{#if grpcResult}
					{@render answer(grpcResult)}
				{/if}
				{#if data.grpc.routes.length === 0}
					<EmptyState
						title="Nothing is transcoded"
						description="The listener is up and serves the health check alone."
					>
						{#snippet iconSnippet()}
							<Network size={ICON.lg} />
						{/snippet}
					</EmptyState>
				{/if}
			{/if}
		</section>
	{:else if tab === 'stream'}
		<StreamLab />
	{/if}
</PageShell>
