<script lang="ts">
	import PageTitle from '$lib/components/PageTitle.svelte';
	import {
		Alert,
		Badge,
		Button,
		Card,
		PageShell,
		SectionHeading,
		Stat,
		Table,
	} from '@lyeve-labs/ui-kit';
	import { invalidateAll } from '$app/navigation';
	import { RefreshCw } from '@lucide/svelte';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import {
		BACKEND_SETTINGS,
		HEALTH_LABELS,
		TOPIC_SHAPE,
		connectionGuide,
		backendLabel,
		brokerHealth,
		deliveryRate,
		healthTone,
	} from '$lib/api/messagebroker';
	import { NO_VALUE, formatDateTime } from '$lib/format';
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

	const health = $derived(brokerHealth(data.status));
	const rate = $derived(deliveryRate(data.status));
	const guide = $derived(data.status ? connectionGuide(data.status.backend, data.status.topic_prefix) : null);
	const backendSettings = $derived(data.status ? (BACKEND_SETTINGS[data.status.backend] ?? []) : []);
</script>

<PageTitle title="Message broker" />

<PageShell
	title="Message broker"
	description="Where content events are published, and whether they are arriving."
	width="wide"
	back={{ href: '/admin/settings', label: 'Settings' }}
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
			The broker status names infrastructure outside this instance and covers every tenant, so
			it is a super admin's to read.
		</Alert>
	{:else if data.gate.state !== 'ok'}
		<GateNotice
			gate={data.gate}
			title="Message broker"
			absent="The message broker plugin is not part of this build, so no event is published."
		/>
	{:else if data.status}
		<div class="flex items-center gap-2">
			<Badge tone={healthTone(health)} dot>{HEALTH_LABELS[health]}</Badge>
			<span class="text-xs text-muted">{backendLabel(data.status.backend)}</span>
		</div>

		{#if data.status.degraded}
			<Alert tone="warn">
				This instance does not enable the plugin, so every event is dropped rather than
				published. Nothing is wrong with the broker.
			</Alert>
		{:else if data.status.failed > 0}
			<Alert tone="danger">
				The broker refused {data.status.failed}
				{data.status.failed === 1 ? 'event' : 'events'}. Publishing is deliberately fire and
				forget, so the content writes behind them all succeeded and nothing else reported
				this.
			</Alert>
		{:else if data.status.dropped > 0 && !data.status.connected}
			<Alert tone="warn">
				{data.status.dropped}
				{data.status.dropped === 1 ? 'event' : 'events'} had nowhere to go, because no broker
				connection was open. That is a configuration problem here, not at the broker.
			</Alert>
		{/if}

		<div class="grid gap-4 sm:grid-cols-3">
			<Stat size="sm" mono label="Published" value={data.status.published} />
			<Stat
				size="sm"
				mono
				label="Refused by the broker"
				value={data.status.failed}
				tone={data.status.failed > 0 ? 'danger' : 'neutral'}
			/>
			<Stat
				size="sm"
				mono
				label="Nowhere to send"
				value={data.status.dropped}
				tone={data.status.dropped > 0 ? 'warn' : 'neutral'}
			/>
		</div>
		<p class="text-xs text-muted">
			Counted since this process started. A restart sets them back to zero, so a low number is
			not on its own a quiet week.
			{#if rate !== null}
				{rate}% of attempts reached the broker.
			{/if}
		</p>

		<section class="flex flex-col gap-4">
			<SectionHeading level={2}>Connection</SectionHeading>
			<Table label="Connection">
				<tbody>
					<tr>
						<th scope="row">Backend</th>
						<td>{backendLabel(data.status.backend)}</td>
					</tr>
					<tr>
						<th scope="row">Connected</th>
						<td>
							<Badge tone={data.status.connected ? 'success' : 'warn'} dot>
								{data.status.connected ? 'Yes' : 'No'}
							</Badge>
						</td>
					</tr>
					<tr>
						<th scope="row">Target</th>
						<!-- The engine removes the credentials before sending this, because a
						     broker URL routinely carries a user and a password and this page
						     gets pasted into support threads. -->
						<td class="font-mono text-xs">{data.status.target || NO_VALUE}</td>
					</tr>
					{#if data.status.stream}
						<tr>
							<th scope="row">Stream</th>
							<td class="font-mono text-xs">{data.status.stream}</td>
						</tr>
					{/if}
					{#if data.status.topic_prefix}
						<tr>
							<th scope="row">Topic prefix</th>
							<td class="font-mono text-xs">{data.status.topic_prefix}</td>
						</tr>
					{/if}
					<tr>
						<th scope="row">TLS</th>
						<td>
							<Badge tone={data.status.tls ? 'success' : 'danger'}>
								{data.status.tls ? 'On' : 'Off'}
							</Badge>
						</td>
					</tr>
					<tr>
						<th scope="row">Topics</th>
						<td class="font-mono text-xs">{TOPIC_SHAPE}</td>
					</tr>
					<tr>
						<th scope="row">Last publish</th>
						<td class="text-xs text-faint">
							{data.status.last_publish_at
								? formatDateTime(data.status.last_publish_at)
								: 'Nothing has been published'}
						</td>
					</tr>
				</tbody>
			</Table>
		</section>

		<section class="flex flex-col gap-4">
			<SectionHeading level={2}>Connecting services</SectionHeading>
			{#if guide}
				<div class="grid gap-4 lg:grid-cols-3">
					<Card>
						<div class="flex flex-col gap-2 text-sm text-muted">
							<SectionHeading level={3}>Hear this instance</SectionHeading>
							<p>
								Every content create, update and delete is published as JSON: the event type, schema,
								tenant, the record and an event id to deduplicate on. A broker outage delays events
								rather than losing them.
							</p>
							<p class="font-mono text-xs break-words text-fg">{guide.listen}</p>
						</div>
					</Card>
					<Card>
						<div class="flex flex-col gap-2 text-sm text-muted">
							<SectionHeading level={3}>Send to this instance</SectionHeading>
							<p>
								A flow whose trigger is <span class="font-medium text-fg">Message received</span> runs once
								per message under its tenant's namespace. Give it a group and every instance sharing the
								group splits the messages. Without one, each instance runs every message.
							</p>
							<p class="font-mono text-xs break-words text-fg">{guide.send}</p>
						</div>
					</Card>
					<Card>
						<div class="flex flex-col gap-2 text-sm text-muted">
							<SectionHeading level={3}>Send from a flow</SectionHeading>
							<p>
								The <span class="font-medium text-fg">Publish a message</span> node sends any payload a flow
								builds, on a subject under the run's tenant, so a flow can call another service the same way
								a content event does.
							</p>
							<a href="/admin/flows" class="text-sm text-brand hover:underline">Open flows</a>
						</div>
					</Card>
				</div>
			{:else}
				<Alert tone="warn">
					Nothing is connected: <span class="font-mono">EVENT_BUS</span> is unset or noop, so events are
					discarded and no flow can hear a message. Set it to nats, kafka or rabbitmq.
				</Alert>
			{/if}
			<p class="text-xs text-muted">
				The broker is configured by the deployment, through <span class="font-mono">EVENT_BUS</span>
				{#if backendSettings.length}and {backendSettings.join(', ')}{/if}. Set them as
				environment variables or in the configuration file, and see what each does on
				<a href="/admin/settings/configuration" class="text-brand hover:underline">Configuration</a>. TLS is on
				by default and a broker's certificate is always verified.
			</p>
		</section>

		{#if data.status.last_error}
			<section class="flex flex-col gap-4">
				<SectionHeading level={2}>Most recent failure</SectionHeading>
				<!-- The current reason, not every one. A broker that is down produces
				     the same line thousands of times. -->
				<div class="rounded border border-line bg-surface-2 p-3">
					<p class="font-mono text-xs text-danger">{data.status.last_error.error}</p>
					<p class="mt-1 text-xs text-faint">
						Publishing to <span class="font-mono">{data.status.last_error.topic}</span>,
						{formatDateTime(data.status.last_error.at)}
					</p>
				</div>
			</section>
		{/if}
	{/if}
</PageShell>
