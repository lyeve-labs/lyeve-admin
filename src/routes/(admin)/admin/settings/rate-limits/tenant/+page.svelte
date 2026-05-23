<script lang="ts">
	import PageTitle from '$lib/components/PageTitle.svelte';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import RefusalNotice from '$lib/components/RefusalNotice.svelte';
	import { formRefusal } from '$lib/api/refusal';
	import {
		Alert,
		Badge,
		Button,
		Card,
		Drawer,
		EmptyState,
		Input,
		PageShell,
		SectionHeading,
		SegmentedControl,
		Table,
		Toggle,
		confirm as confirmDialog,
		toast,
	} from '@lyeve-labs/ui-kit';
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { tracked } from '$lib/forms.svelte';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { Gauge, Plus, ShieldBan, Trash2 } from '@lucide/svelte';
	import {
		HISTORY_WINDOWS,
		addressLimit,
		rateLabel,
		refusalKindLabel,
		refusalTotals,
		type AddressEntry,
		type AddressList,
	} from '$lib/api/rate-limit';
	import { atLimit } from '$lib/api/limits';
	import { formatCount, formatDateTime } from '$lib/format';
	import { ICON } from '$lib/icon';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const refusal = $derived(formRefusal(form));
	const formError = $derived((form as { error?: string } | null)?.error ?? '');
	const lockout = $derived((form as { lockout?: string } | null)?.lockout ?? '');

	const limitRead = $derived(data.limit.value);
	const own = $derived(limitRead?.tenant_global ?? null);
	const install = $derived(limitRead?.install_global ?? null);
	const addresses = $derived(data.addresses.value);
	const entries = $derived(addresses?.rules ?? []);
	const entryLimit = $derived(addresses ? addressLimit(addresses) : null);
	const allow = $derived(entries.filter((e) => e.list === 'allow'));
	const deny = $derived(entries.filter((e) => e.list === 'deny'));
	const history = $derived(data.history.value);
	const totals = $derived(refusalTotals(history?.minutes ?? []));
	const entryCidr = $derived(new Map(entries.map((e) => [e.id, e.cidr])));

	let limitOpen = $state(false);
	let rate = $state('10');
	let burst = $state('20');
	let limitEnabled = $state(true);

	function openLimit() {
		rate = String(own?.rate ?? install?.rate ?? 10);
		burst = String(own?.burst ?? install?.burst ?? 20);
		limitEnabled = own?.enabled ?? true;
		limitOpen = true;
	}

	const saveLimit = tracked(() => async ({ result, update }) => {
		if (result.type !== 'failure') limitOpen = false;
		await update();
		if (result.type === 'success') toast.success('Saved the tenant limit');
	});

	let addressOpen = $state(false);
	let cidr = $state('');
	let list = $state<AddressList>('allow');
	let note = $state('');

	function openAddress(which: AddressList) {
		cidr = '';
		list = which;
		note = '';
		addressOpen = true;
	}

	const saveAddress = tracked(() => {
		const subject = cidr;
		const where = list;
		return async ({ result, update }) => {
			if (result.type !== 'failure') addressOpen = false;
			await update();
			if (result.type === 'success') toast.success(`Added ${subject} to the ${where} list`);
		};
	});

	function removeAddress(e: AddressEntry): SubmitFunction {
		return async ({ cancel }) => {
			const confirmed = await confirmDialog(
				`Remove ${e.cidr} from the ${e.list} list?`,
				e.list === 'allow'
					? 'Requests from it are counted against the tenant rules again.'
					: 'Requests from it are served again from the next request.',
				{ confirmLabel: 'Delete' },
			);
			if (!confirmed) {
				cancel();
				return;
			}
			return async ({ result, update }) => {
				await update();
				if (result.type === 'success') toast.success(`Removed ${e.cidr}`);
			};
		};
	}

	const clearLimit: SubmitFunction = async ({ cancel }) => {
		const confirmed = await confirmDialog(
			'Clear the tenant limit?',
			'This tenant goes back to the install-wide limit alone.',
			{ confirmLabel: 'Clear' },
		);
		if (!confirmed) {
			cancel();
			return;
		}
		return async ({ result, update }) => {
			await update();
			if (result.type === 'success') toast.success('Cleared the tenant limit');
		};
	};

	// The window follows the address, so going back shows the window it named.
	let hours = $state('24');
	$effect(() => {
		hours = String(data.hours);
	});
	function showWindow(value: string) {
		void goto(`?hours=${value}`, { keepFocus: true, noScroll: true });
	}
</script>

<PageTitle title="Tenant rate limits" />

{#snippet addressCard(which: AddressList, rows: AddressEntry[], title: string)}
	<Card pad="md">
		<div class="flex flex-col gap-3">
			<div class="flex items-center justify-between gap-2">
				<SectionHeading level={3}>{title}</SectionHeading>
				<Button variant="secondary" size="sm" onclick={() => openAddress(which)}>
					<Plus size={ICON.sm} /> New address
				</Button>
			</div>
			{#if rows.length === 0}
				<p class="text-sm text-muted">
					{which === 'allow' ? 'No address skips the rules.' : 'No address is refused.'}
				</p>
			{:else}
				<Table label={title}>
					<thead>
						<tr>
							<th scope="col">Address</th>
							<th scope="col">Note</th>
							<th scope="col"><span class="sr-only">Actions</span></th>
						</tr>
					</thead>
					<tbody>
						{#each rows as e (e.id)}
							<tr>
								<td data-cell="nowrap" class="font-mono text-xs">{e.cidr}</td>
								<td class="text-xs text-muted">{e.note || '-'}</td>
								<td data-cell="nowrap">
									<div class="flex justify-end">
										<form method="POST" action="?/deleteAddress" use:enhance={removeAddress(e)}>
											<input type="hidden" name="id" value={e.id} />
											<Button variant="ghost" size="sm" type="submit" aria-label="Delete {e.cidr}">
												<Trash2 size={ICON.sm} class="text-danger" />
											</Button>
										</form>
									</div>
								</td>
							</tr>
						{/each}
					</tbody>
				</Table>
			{/if}
		</div>
	</Card>
{/snippet}

<PageShell
	title="Tenant rate limits"
	description="This tenant's own limit, the addresses it always serves or always refuses, and what was refused."
	width="wide"
	back={{ href: '/admin/settings/rate-limits', label: 'Rate limits' }}
>
	{#if data.gate.state !== 'ok'}
		<GateNotice
			gate={data.gate}
			title="Rate limits"
			absent="The rate limit plugin is not part of this build, so no request is limited."
		/>
	{:else}
		{#if refusal}
			<RefusalNotice {refusal} />
		{:else if lockout}
			<Alert tone="danger" title="That entry would lock you out">
				<p>
					{lockout} covers the address you are signed in from, and nothing on the allow list covers it. Saving it
					would refuse this console to you, and only an operator of the install could undo that.
				</p>
				<p class="mt-2">
					Add your own address to the allow list first, then deny the range. An allowed address is served
					whatever the deny list says.
				</p>
			</Alert>
		{:else if formError}
			<Alert tone="danger">{formError}</Alert>
		{/if}

		<section class="flex flex-col gap-4" aria-label="Tenant limit">
			<SectionHeading level={2}>Tenant limit</SectionHeading>
			{#if data.limit.gate.state !== 'ok'}
				<GateNotice gate={data.limit.gate} title="Tenant limit" absent="This version of the plugin has no tenant limit." />
			{:else}
				<Card pad="md">
					<div class="flex flex-wrap items-start justify-between gap-4">
						<div class="flex flex-col gap-1 text-sm">
							{#if own}
								<p class="text-fg">
									<span class="font-mono">{rateLabel(own.rate)}</span>, bursts of {formatCount(own.burst)}
									<Badge tone={own.enabled ? 'success' : 'neutral'} dot>{own.enabled ? 'Enforced' : 'Off'}</Badge>
								</p>
							{:else}
								<p class="text-fg">No limit of this tenant's own.</p>
							{/if}
							<p class="text-muted">
								{#if install && install.enabled}
									The install-wide limit of {rateLabel(install.rate)} with bursts of {formatCount(install.burst)} applies
									beside it, so a tenant limit can only tighten it.
								{:else}
									The install sets no global limit.
								{/if}
							</p>
						</div>
						<div class="flex items-center gap-2">
							{#if own}
								<form method="POST" action="?/clearLimit" use:enhance={clearLimit}>
									<Button variant="secondary" size="sm" type="submit">Clear</Button>
								</form>
							{/if}
							<Button variant="secondary" size="sm" onclick={openLimit}>
								<Gauge size={ICON.sm} />
								{own ? 'Edit' : 'Set a limit'}
							</Button>
						</div>
					</div>
					{#if limitRead && !limitRead.licensed}
						<p class="mt-3 text-xs text-faint">
							Setting or changing this limit needs a license this install does not hold. Clearing it is always
							allowed.
						</p>
					{/if}
				</Card>
			{/if}
		</section>

		<section class="flex flex-col gap-4" aria-label="Address lists">
			<div class="flex flex-wrap items-center gap-2">
				<SectionHeading level={2}>Address lists</SectionHeading>
				{#if entryLimit}
					<Badge tone={atLimit(entryLimit) ? 'warn' : 'neutral'}>
						{#if entryLimit.limit !== null}
							{formatCount(entryLimit.current)} of {formatCount(entryLimit.limit)} entries
						{:else}
							{formatCount(entryLimit.current)} {entryLimit.current === 1 ? 'entry' : 'entries'}
						{/if}
					</Badge>
				{/if}
			</div>
			<p class="text-sm text-muted">
				An allowed address skips this tenant's rules. A denied one is refused with 403 before any rule is counted.
				An address on both lists is allowed.
			</p>
			{#if data.addresses.gate.state !== 'ok'}
				<GateNotice
					gate={data.addresses.gate}
					title="Address lists"
					absent="This version of the plugin keeps no address lists."
				/>
			{:else}
				{#if addresses && !addresses.licensed}
					<Alert tone="brand">
						Adding an address needs a license this install does not hold. Entries already saved keep applying, and
						removing one is always allowed.
					</Alert>
				{/if}
				<div class="grid gap-4 lg:grid-cols-2">
					{@render addressCard('allow', allow, 'Allow list')}
					{@render addressCard('deny', deny, 'Deny list')}
				</div>
			{/if}
		</section>

		<section class="flex flex-col gap-4" aria-label="Refusal history">
			<div class="flex flex-wrap items-center justify-between gap-2">
				<SectionHeading level={2}>Refusal history</SectionHeading>
				<SegmentedControl
					label="Window"
					labelHidden
					bind:value={hours}
					options={HISTORY_WINDOWS.map((w) => ({ value: w.value, label: w.label }))}
					onchange={showWindow}
				/>
			</div>
			{#if data.history.gate.state !== 'ok'}
				<GateNotice
					gate={data.history.gate}
					title="Refusal history"
					absent="This version of the plugin records no refusal history."
				/>
			{:else if history}
				{#if totals.length === 0}
					<EmptyState title="Nothing was refused" description="No rule or list entry refused a request in this window.">
						{#snippet iconSnippet()}
							<ShieldBan size={ICON.lg} />
						{/snippet}
					</EmptyState>
				{:else}
					<p class="text-sm text-muted">{formatCount(history.total_refused)} requests refused.</p>
					<Table label="Refusals by rule">
						<thead>
							<tr>
								<th scope="col">Refused by</th>
								<th scope="col">Route or address</th>
								<th scope="col">Requests</th>
								<th scope="col">Last</th>
							</tr>
						</thead>
						<tbody>
							{#each totals as t (`${t.rule_id}-${t.kind}-${t.endpoint}`)}
								<tr>
									<td data-cell="nowrap" class="text-xs">{refusalKindLabel(t.kind)}</td>
									<td class="max-w-md truncate font-mono text-xs" title={t.endpoint}>
										{t.kind === 'deny' ? (entryCidr.get(t.rule_id) ?? t.endpoint) : t.endpoint}
									</td>
									<td data-cell="nowrap" class="font-mono text-xs">{formatCount(t.refused)}</td>
									<td data-cell="nowrap" class="text-xs text-faint">{formatDateTime(t.last)}</td>
								</tr>
							{/each}
						</tbody>
					</Table>
				{/if}
			{/if}
		</section>
	{/if}
</PageShell>

<Drawer bind:open={limitOpen} title="Tenant limit">
	{#if refusal}
		<div class="mb-4"><RefusalNotice {refusal} /></div>
	{:else if formError}
		<div class="mb-4"><Alert tone="danger">{formError}</Alert></div>
	{/if}
	<form id="tenant-limit-form" method="POST" action="?/setLimit" use:enhance={saveLimit.enhance}>
		<div class="flex flex-col gap-4">
			<Input
				id="tenant-rate"
				name="rate"
				label="Rate, requests per second"
				hint={install?.enabled ? `At most ${install.rate}, the install-wide rate.` : 'Sustained requests per second.'}
				bind:value={rate}
				required
			/>
			<Input
				id="tenant-burst"
				name="burst"
				label="Burst"
				hint={install?.enabled ? `At most ${install.burst}, the install-wide burst.` : 'How many requests may arrive at once.'}
				bind:value={burst}
				required
			/>
			<input type="hidden" name="enabled" value={limitEnabled ? 'true' : 'false'} />
			<Toggle id="tenant-limit-enabled" label="Enforce this limit" bind:checked={limitEnabled} />
		</div>
	</form>
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (limitOpen = false)}>Cancel</Button>
		<Button variant="primary" type="submit" form="tenant-limit-form" loading={saveLimit.pending}>Save</Button>
	{/snippet}
</Drawer>

<Drawer bind:open={addressOpen} title="New address">
	{#if refusal}
		<div class="mb-4"><RefusalNotice {refusal} /></div>
	{:else if formError}
		<div class="mb-4"><Alert tone="danger">{formError}</Alert></div>
	{/if}
	<form id="address-form" method="POST" action="?/addAddress" use:enhance={saveAddress.enhance}>
		<div class="flex flex-col gap-4">
			<SegmentedControl
				label="List"
				name="list"
				bind:value={list}
				options={[
					{ value: 'allow', label: 'Allow' },
					{ value: 'deny', label: 'Deny' },
				]}
			/>
			<Input
				id="address-cidr"
				name="cidr"
				label="Address or range"
				placeholder="203.0.113.0/24"
				hint="One IPv4 or IPv6 address, or a CIDR range."
				bind:value={cidr}
				required
			/>
			<Input id="address-note" name="note" label="Note" hint="Why it is here, for whoever reads the list next." bind:value={note} />
			{#if list === 'deny'}
				<p class="text-xs text-muted">
					A deny entry that covers the address you are signed in from is refused unless that address is on the
					allow list.
				</p>
			{/if}
		</div>
	</form>
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (addressOpen = false)}>Cancel</Button>
		<Button variant="primary" type="submit" form="address-form" loading={saveAddress.pending}>Create</Button>
	{/snippet}
</Drawer>
