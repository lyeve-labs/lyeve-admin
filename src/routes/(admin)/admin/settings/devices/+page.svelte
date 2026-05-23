<script lang="ts">
	import PageTitle from '$lib/components/PageTitle.svelte';
	import {
		Alert,
		Badge,
		Button,
		EmptyState,
		Input,
		PageShell,
		SectionHeading,
		Table,
		confirm as confirmDialog,
		toast,
		Pagination,
	} from '@lyeve-labs/ui-kit';
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { MonitorSmartphone, Trash2 } from '@lucide/svelte';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import { deviceLabel, deviceName, looksLikeThisDevice, type Device } from '$lib/api/devices';
	import { formatDateTime } from '$lib/format';
	import type { ActionData, PageData } from './$types';
	import { pageHref, pageNumber } from '$lib/api/list';
	import { ICON } from '$lib/icon';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const formError = $derived((form as { error?: string } | null)?.error ?? '');
	let label = $state('');
	const suggestedName = $derived(deviceName(data.userAgent ?? ''));

	const thisOne = $derived(
		data.devices.find((d) => looksLikeThisDevice(d, data.userAgent)) ?? null,
	);

	const trustThis: SubmitFunction = () => {
		const subject = label;
		return async ({ result, update }) => {
			if (result.type !== 'failure') label = '';
			await update();
			if (result.type === 'success') toast.success(`Trusted ${subject}`);
		};
	};

	/**
	 * Forgetting a device is the security control on this page, so it asks, and
	 * it says what actually happens: the device is not blocked, it stops being
	 * remembered, and the next sign-in from it is treated as a new one.
	 */
	function forget(d: Device): SubmitFunction {
		return async ({ cancel }) => {
			const confirmed = await confirmDialog(
				`Forget ${deviceLabel(d)}?`,
				'It stops being a trusted device. Signing in from it again is treated as a new device.',
				{ confirmLabel: 'Forget' },
			);
			if (!confirmed) {
				cancel();
				return;
			}
			return async ({ result, update }) => {
				await update();
				if (result.type === 'success') toast.success(`Forgot ${deviceLabel(d)}`);
			};
		};
	}
</script>

<PageTitle title="Trusted devices" />

<PageShell
	title="Trusted devices"
	description="Browsers this account is remembered on. The list belongs to the account, not the instance."
	width="wide"
	back={{ href: '/admin/settings', label: 'Settings' }}
>
	{#if data.gate.state !== 'ok'}
		<GateNotice
			gate={data.gate}
			title="Device recognition"
			absent="The device recognition plugin is not part of this build, so no device is remembered."
		/>
	{:else}
		{#if formError}
			<Alert tone="danger">{formError}</Alert>
		{/if}

		<section class="flex flex-col gap-4">
			<SectionHeading level={2}>This browser</SectionHeading>
			{#if thisOne}
				<Alert tone="success" autoDismiss>
					This browser is already trusted, as {deviceLabel(thisOne)}.
				</Alert>
			{:else}
				<p class="text-xs text-muted">
					Trusting remembers the browser you are reading this in. There is no way to trust a
					different one from here: the fingerprint comes from the request itself.
				</p>
				<form
					method="POST"
					action="?/trust"
					use:enhance={trustThis}
					class="flex max-w-md flex-col items-start gap-3"
				>
					<div class="w-full">
						<Input
							id="device-label"
							name="label"
							label="Name this device"
							placeholder={suggestedName}
							hint="Something you will recognize in the list."
							bind:value={label}
							required
						/>
					</div>
					<Button variant="primary" type="submit">Trust this browser</Button>
				</form>
			{/if}
		</section>

		<section class="flex flex-col gap-4">
			<SectionHeading level={2}>Remembered devices</SectionHeading>

			{#if data.devices.length === 0}
				<EmptyState
					title="No device is remembered"
					description="Every sign-in on this account is treated as coming from somewhere new."
				>
					{#snippet iconSnippet()}
						<MonitorSmartphone size={ICON.lg} />
					{/snippet}
				</EmptyState>
			{:else}
				<Table label="Remembered devices">
					<thead>
						<tr>
							<th scope="col">Device</th>
							<th scope="col">Last seen</th>
							<th scope="col">Added</th>
							<th scope="col"><span class="sr-only">Actions</span></th>
						</tr>
					</thead>
					<tbody>
						{#each data.devices as d (d.id)}
							<tr>
								<td data-cell="nowrap">
									<div class="flex items-center gap-2">
										<span class="font-medium text-fg">{deviceLabel(d)}</span>
										{#if looksLikeThisDevice(d, data.userAgent)}
											<!-- Matched on the user agent, which two identical
											     browsers share, so it claims a resemblance and
											     not an identity. -->
											<Badge tone="brand">Looks like this one</Badge>
										{/if}
									</div>
									<div class="text-xs text-faint" title={d.user_agent}>
										{deviceName(d.user_agent)}
									</div>
								</td>
								<td data-cell="nowrap" class="text-xs text-faint">
									{formatDateTime(d.last_seen_at)}
								</td>
								<td data-cell="nowrap" class="text-xs text-faint">
									{formatDateTime(d.created_at)}
								</td>
								<td data-cell="nowrap">
									<div class="flex justify-end">
										<form method="POST" action="?/untrust" use:enhance={forget(d)}>
											<input type="hidden" name="id" value={d.id} />
											<Button
												variant="ghost"
												size="sm"
												type="submit"
												aria-label="Forget {deviceLabel(d)}"
											>
												<Trash2 size={ICON.sm} class="text-danger" />
											</Button>
										</form>
									</div>
								</td>
							</tr>
						{/each}
					</tbody>
				</Table>
				<Pagination
					page={pageNumber(data.offset, data.limit)}
					perPage={data.limit}
					count={data.devices.length}
					total={data.total ?? undefined}
					hasNext={data.hasMore}
					noun="devices"
					href={pageHref('/admin/settings/devices', data.limit)}
				/>
			{/if}
		</section>
	{/if}
</PageShell>
