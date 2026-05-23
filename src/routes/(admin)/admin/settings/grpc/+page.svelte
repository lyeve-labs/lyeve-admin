<script lang="ts">
	import PageTitle from '$lib/components/PageTitle.svelte';
	import {
		Alert,
		Badge,
		Button,
		CopyButton,
		EmptyState,
		PageShell,
		SectionHeading,
		Table,
	} from '@lyeve-labs/ui-kit';
	import { invalidateAll } from '$app/navigation';
	import { Network, RefreshCw } from '@lucide/svelte';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import {
		HEALTH_LABELS,
		grpcHealth,
		healthTone,
		loopbackOnly,
		reflectionNote,
		serviceStatusLabel,
		serviceTone,
		undeclared,
	} from '$lib/api/grpc';
	import { NO_VALUE } from '$lib/format';
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

	const health = $derived(grpcHealth(data.status));
	const gaps = $derived(undeclared(data.status));
	const note = $derived(reflectionNote(data.status));
</script>

<PageTitle title="gRPC" />

<PageShell
	title="gRPC"
	description="The listener this plugin serves on, and what answers there."
	width="wide"
>
	{#snippet actions()}
		{#if data.permitted && data.gate.state === 'ok'}
			<Button variant="secondary" size="sm" onclick={refresh} loading={refreshing}>
				<RefreshCw size={ICON.sm} /> Refresh
			</Button>
		{/if}
	{/snippet}

	{#if !data.permitted}
		<Alert tone="brand">
			The gRPC status names the addresses this process listens on, so it is a super admin's to
			read.
		</Alert>
	{:else if data.gate.state !== 'ok'}
		<GateNotice
			gate={data.gate}
			title="gRPC"
			absent="The gRPC plugin is not part of this build, so nothing is listening."
		/>
	{:else if data.status}
		<div class="flex items-center gap-2">
			<Badge tone={healthTone(health)} dot>{HEALTH_LABELS[health]}</Badge>
		</div>

		{#if data.status.degraded}
			<!-- No listener was bound on purpose. Calling it a bind failure
			     sends somebody to look at ports. -->
			<Alert tone="warn">
				This instance does not enable the plugin, so no listener was started. Nothing is wrong
				with the port.
			</Alert>
		{:else if !data.status.listening}
			<Alert tone="danger">
				The plugin is enabled and nothing is listening. Check the engine's start-up log for a
				bind failure on the configured address.
			</Alert>
		{/if}

		{#if gaps.length > 0}
			<!-- A service registered on the server and never declared to the
			     health server answers calls while a client that health checks
			     first is told it does not exist. -->
			<Alert tone="warn">
				{gaps.length}
				{gaps.length === 1 ? 'service is' : 'services are'} registered on the server but unknown
				to the health protocol. They answer calls, and a client that health checks before
				calling is told they do not exist.
			</Alert>
		{/if}

		<section class="flex flex-col gap-4">
			<SectionHeading level={2}>Listeners</SectionHeading>
			<Table label="Listeners">
				<tbody>
					<tr>
						<th scope="row">gRPC</th>
						<td>
							<div class="flex items-center gap-2">
								<code class="font-mono text-xs">{data.status.address || NO_VALUE}</code>
								{#if data.status.address}
									<CopyButton value={data.status.address} label="Copy the gRPC address" />
								{/if}
							</div>
							{#if loopbackOnly(data.status.address)}
								<!-- The right default, and also the reason a client on
								     another machine cannot connect. -->
								<div class="text-xs text-faint">
									Loopback only, so nothing outside this host can reach it.
								</div>
							{/if}
						</td>
					</tr>
					<tr>
						<th scope="row">Health and REST</th>
						<td>
							<code class="font-mono text-xs">{data.status.health_address || NO_VALUE}</code>
							{#if loopbackOnly(data.status.health_address)}
								<div class="text-xs text-faint">
									Loopback only, so nothing outside this host can reach it.
								</div>
							{/if}
						</td>
					</tr>
					<tr>
						<th scope="row">Reflection</th>
						<td>
							<Badge tone={data.status.reflection ? 'warn' : 'neutral'}>
								{data.status.reflection ? 'On' : 'Off'}
							</Badge>
						</td>
					</tr>
				</tbody>
			</Table>
			{#if note}
				<p class="text-xs text-muted">{note}</p>
			{/if}
		</section>

		<section class="flex flex-col gap-4">
			<SectionHeading level={2}>Services</SectionHeading>
			{#if data.status.services.length === 0}
				<EmptyState
					title="No service is registered"
					description="The listener is up and nothing answers on it."
				>
					{#snippet iconSnippet()}
						<Network size={ICON.lg} />
					{/snippet}
				</EmptyState>
			{:else}
				<Table label="Services">
					<thead>
						<tr>
							<th scope="col">Service</th>
							<th scope="col">Health says</th>
						</tr>
					</thead>
					<tbody>
						{#each data.status.services as svc (svc.name)}
							<tr>
								<td data-cell="nowrap" class="font-mono text-xs">{svc.name}</td>
								<td data-cell="nowrap">
									<Badge tone={serviceTone(svc.status)} dot>
										{serviceStatusLabel(svc.status)}
									</Badge>
								</td>
							</tr>
						{/each}
					</tbody>
				</Table>
			{/if}
		</section>

		{#if data.status.transcoded_routes.length > 0}
			<section class="flex flex-col gap-4">
				<SectionHeading level={2}>REST, without a gRPC client</SectionHeading>
				<p class="text-xs text-muted">
					Served on the health listener above, against the same service implementations. A
					caller with no generated stubs can use these.
				</p>
				<ul class="flex flex-col gap-1">
					{#each data.status.transcoded_routes as route (route)}
						<li class="font-mono text-xs text-faint">{route}</li>
					{/each}
				</ul>
			</section>
		{/if}
	{/if}
</PageShell>
