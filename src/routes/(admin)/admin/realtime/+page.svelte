<script lang="ts">
	import {
		Badge,
		Card,
		EmptyState,
		PageShell,
		SectionHeading,
		Stat,
		Table,
		Button,
	} from '@lyeve-labs/ui-kit';
	import { invalidateAll } from '$app/navigation';
	import { Radio, RefreshCw, Satellite, Users } from '@lucide/svelte';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import { inUse, tenantLoad, uptimeSince, type StreamMetrics } from '$lib/api/realtime';
	import { NO_VALUE, formatCount } from '$lib/format';
	import type { PageData } from './$types';
	import { ICON } from '$lib/icon';

	let { data }: { data: PageData } = $props();

	let refreshing = $state(false);
	async function refresh() {
		refreshing = true;
		try {
			await invalidateAll();
		} finally {
			refreshing = false;
		}
	}

	const streamUsed = $derived(inUse(data.stream));
	const socketUsed = $derived(inUse(data.socket));
	const loads = $derived(tenantLoad(data.platform?.connections_by_tenant));
	// The plugin's tenant view hard-codes the idle count to zero, so it is no
	// measurement and is not shown.
	const socketStates = $derived(
		Object.entries(data.socket?.connections_by_state ?? {}).filter(([state]) => state !== 'idle'),
	);

	function pct(share: number): string {
		return `${Math.round(share * 100)}%`;
	}

	/** The window the cumulative counters cover, so a total means something. */
	function window_(m: StreamMetrics | null): string {
		return m ? uptimeSince(m.since) : NO_VALUE;
	}
</script>

<PageShell
	title="Realtime"
	description="Who is connected over server-sent events and WebSocket, and what has been pushed to them."
	width="wide"
>
	{#snippet actions()}
		<Button variant="secondary" size="sm" onclick={refresh} loading={refreshing}>
			<RefreshCw size={ICON.sm} /> Refresh
		</Button>
	{/snippet}

	{#if data.gate.state !== 'ok'}
		<GateNotice
			level={2}
			gate={data.gate}
			title="Realtime"
			absent="The realtime plugin is not part of this build, so nothing is holding connections open."
		/>
	{:else}
		<section class="flex flex-col gap-4">
			<SectionHeading level={2}>Server-sent events</SectionHeading>
			{#if data.streamGate}
				<GateNotice gate={data.streamGate} title="the server-sent events counters" absent="This build does not serve server-sent events." />
			{:else if !streamUsed}
				<p class="text-sm text-muted">
					Nothing has connected over this transport. That is a transport nobody is using, not a
					fault.
				</p>
			{/if}
			{#if !data.streamGate}
				<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
					<Stat size="sm" mono label="Open now" value={formatCount(data.stream?.active_connections)} />
					<Stat
						size="sm"
						mono
						label="Accepted in {window_(data.stream)}"
						value={formatCount(data.stream?.total_connections)}
					/>
					<Stat size="sm" mono label="Events pushed, whole instance" value={formatCount(data.stream?.events_dispatched)} />
					<Stat
						size="sm"
						mono
						label="Rejected, whole instance"
						value={formatCount(data.stream?.connections_rejected)}
						tone={(data.stream?.connections_rejected ?? 0) > 0 ? 'warn' : undefined}
					/>
				</div>
				<p class="text-xs text-faint">
					Open now and accepted count this tenant's connections. The other counters cover every tenant on
					the instance.
				</p>
			{/if}
		</section>

		<section class="flex flex-col gap-4">
			<SectionHeading level={2}>WebSocket</SectionHeading>
			{#if data.socketGate}
				<GateNotice gate={data.socketGate} title="the WebSocket counters" absent="This build does not serve WebSocket connections." />
			{:else if !socketUsed}
				<p class="text-sm text-muted">
					Nothing has connected over this transport. That is a transport nobody is using, not a
					fault.
				</p>
			{/if}
			{#if !data.socketGate}
				<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
					<Stat size="sm" mono label="Open now" value={formatCount(data.socket?.active_connections)} />
					<Stat size="sm" mono label="Broadcasts, whole instance" value={formatCount(data.socket?.broadcasts_sent)} />
					<Stat size="sm" mono label="Reconnections, whole instance" value={formatCount(data.socket?.reconnections)} />
				</div>
				<p class="text-xs text-faint">
					Open now counts this tenant's sockets. Broadcasts and reconnections cover every tenant on the
					instance.
				</p>
			{/if}

			{#if socketStates.length > 0}
				<Card>
					<div class="flex flex-wrap items-center gap-2">
						<span class="text-xs text-muted">Sockets by state</span>
						{#each socketStates as [state, count] (state)}
							<Badge tone="neutral">{state} {count}</Badge>
						{/each}
					</div>
				</Card>
			{/if}
		</section>

		{#if data.superAdmin}
			<section class="flex flex-col gap-4">
				<SectionHeading level={2}>Connections by tenant</SectionHeading>
				{#if data.platformGate}
					<GateNotice
						gate={data.platformGate}
						title="the per-tenant roster"
						absent="This version of the realtime plugin keeps no per-tenant roster."
					/>
				{:else if loads.length === 0}
					<EmptyState
						title="No tenant has a connection open"
						description="The roster lists a tenant only while it is holding a stream open."
					>
						{#snippet iconSnippet()}
							<Users size={ICON.lg} />
						{/snippet}
					</EmptyState>
				{:else}
					<Table label="Connections by tenant">
						<thead>
							<tr>
								<th scope="col">Tenant</th>
								<th scope="col">Open now</th>
								<th scope="col">Share</th>
							</tr>
						</thead>
						<tbody>
							{#each loads as load (load.tenant)}
								<tr>
									<td data-cell="nowrap" class="font-mono text-xs">{load.tenant}</td>
									<td data-cell="nowrap">{load.connections}</td>
									<td data-cell="nowrap" class="text-xs text-faint">{pct(load.share)}</td>
								</tr>
							{/each}
						</tbody>
					</Table>
				{/if}
			</section>
		{/if}

		{#if !data.streamGate && !data.socketGate && !streamUsed && !socketUsed}
			<EmptyState
				title="Nothing is connected"
				description="The plugin is running and neither transport has been used. Open a stream from a client to see it here."
			>
				{#snippet iconSnippet()}
					<Satellite size={ICON.lg} />
				{/snippet}
			</EmptyState>
		{/if}
	{/if}
</PageShell>
