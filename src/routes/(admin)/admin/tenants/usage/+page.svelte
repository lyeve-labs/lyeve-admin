<script lang="ts">
	import PageTitle from '$lib/components/PageTitle.svelte';
	import {
		Alert,
		Badge,
		Button,
		Drawer,
		EmptyState,
		Input,
		NumberInput,
		PageShell,
		SectionHeading,
		Stat,
		Table,
		Toggle,
		confirm as confirmDialog,
		toast, Pagination } from '@lyeve-labs/ui-kit';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { Check, Gauge, Pencil, Plus, X } from '@lucide/svelte';
	import FormErrors from '$lib/components/FormErrors.svelte';
	import { fieldErrors, submitter } from '$lib/forms.svelte';
	import { formRefusal } from '$lib/api/refusal';
	import {
		blocked,
		bytes,
		bytesToGib,
		enforcementLabel,
		enforcementTone,
		enforces,
		hasAnyLimit,
		limitLabel,
		pending,
		uncheckedDimensions,
		usageTone,
		usedPct,
		type Quota,
		type QuotaRequest,
	} from '$lib/api/usage';
	import { formatDateTime, formatCount } from '$lib/format';
	import type { ActionData, PageData } from './$types';
	import { pageHref, pageNumber } from '$lib/api/list';
	import { ICON } from '$lib/icon';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	// The tenant list is the super admin's. An admin who can read this page
	// would be sent to a 403 by a way back that names it.
	const back = $derived(
		data.user?.roles?.includes('super_admin') ? { href: '/admin/tenants', label: 'Tenants' } : undefined,
	);

	const formError = $derived((form as { error?: string } | null)?.error ?? '');
	const errors = $derived(fieldErrors(form));
	const refused = $derived(formRefusal(form));

	// One drawer for a new quota and an existing one.
	let editorOpen = $state(false);
	let editing = $state<Quota | null>(null);
	let tenantId = $state('');
	let requestsLimit = $state(0);
	let storageGib = $state(0);
	let bandwidthGib = $state(0);
	let hardLimit = $state(false);
	let blockOnExceeded = $state(false);
	let graceHours = $state(0);
	let warn80 = $state(true);
	let warn90 = $state(true);
	const saveQuota = submitter(() => (editorOpen = false));

	function openQuota(q: Quota | null) {
		editing = q;
		tenantId = q?.tenant_id ?? '';
		requestsLimit = q?.requests_limit ?? 0;
		storageGib = bytesToGib(q?.storage_bytes_limit ?? 0);
		bandwidthGib = bytesToGib(q?.bandwidth_bytes_limit ?? 0);
		hardLimit = q?.is_hard_limit ?? false;
		blockOnExceeded = q?.block_on_exceeded ?? false;
		graceHours = q?.grace_period_hours ?? 0;
		warn80 = q?.warn_at_pct_80 ?? true;
		warn90 = q?.warn_at_pct_90 ?? true;
		editorOpen = true;
	}

	let clearForm = $state<HTMLFormElement>();
	async function askClear() {
		if (!editing) return;
		const ok = await confirmDialog(`Remove the quota for ${editing.tenant_id}?`, 'The tenant may use as much as it likes, and a block on it is lifted.', {
			confirmLabel: 'Delete',
		});
		if (!ok) return;
		editorOpen = false;
		await Promise.resolve();
		clearForm?.requestSubmit();
	}
	const waiting = $derived(pending(data.requests));
	const stopped = $derived(blocked(data.quotas));
	const reportingOnly = $derived(
		data.quotas.filter((q) => hasAnyLimit(q) && !enforces(q)),
	);
	const usageByTenant = $derived(new Map(data.usage.map((u) => [u.tenant_id, u])));

	function review(r: QuotaRequest, decision: 'approve' | 'deny'): SubmitFunction {
		return async ({ cancel }) => {
			if (decision === 'approve') {
				const confirmed = await confirmDialog(
					`Approve more quota for ${r.tenant_id}?`,
					'Their limits are raised to what they asked for.',
					{ confirmLabel: 'Approve' },
				);
				if (!confirmed) {
					cancel();
					return;
				}
			}
			return async ({ result, update }) => {
				await update();
				if (result.type === 'success') {
					toast.success(decision === 'approve' ? 'Approved' : 'Denied');
				}
			};
		};
	}
</script>

<PageTitle title="Quotas and usage" />

<PageShell
	title="Quotas and usage"
	description="What each tenant is allowed, what they have used, and who is asking for more."
	width="wide"
	{back}
>
	{#snippet actions()}
		{#if data.permitted && data.gate.state === 'ok'}
			<Button variant="primary" size="sm" onclick={() => openQuota(null)}>
				<Plus size={ICON.sm} /> New quota
			</Button>
		{/if}
	{/snippet}

	{#if !data.permitted}
		<Alert tone="brand">
			Quotas cover every tenant, so reading and reviewing them is a super admin's.
		</Alert>
	{:else if data.gate.state !== 'ok'}
		<GateNotice
			gate={data.gate}
			title="Quotas and usage"
			absent="The usage plugin is not part of this build, so nothing is metered or capped."
		/>
	{:else}
		{#if !editorOpen}
			<FormErrors message={formError || undefined} {refused} />
		{/if}
		{#if form && 'quotaSaved' in form}
			<Alert tone="success" autoDismiss>Quota saved for {form.quotaSaved}.</Alert>
		{:else if form && 'quotaCleared' in form}
			<Alert tone="success" autoDismiss>Quota removed for {form.quotaCleared}.</Alert>
		{/if}

		<div class="grid gap-4 sm:grid-cols-3">
			<Stat size="sm" mono label="Quotas set" value={data.quotas.length} />
			<Stat
				size="sm"
				mono
				label="Tenants blocked"
				value={stopped.length}
				tone={stopped.length > 0 ? 'danger' : 'neutral'}
			/>
			<Stat
				size="sm"
				mono
				label="Requests waiting"
				value={data.requestsRead ? waiting.length : '?'}
				tone={waiting.length > 0 ? 'warn' : 'neutral'}
			/>
		</div>

		{#if reportingOnly.length > 0}
			<!-- A soft quota is a reporting line: the tenant passes it and
			     nothing stops. It is also what unticked boxes give you, so a
			     page showing numbers alone describes enforcement that may not
			     exist. -->
			<Alert tone="warn">
				{reportingOnly.length}
				{reportingOnly.length === 1 ? 'quota is' : 'quotas are'} reported and never enforced. A
				tenant passes those limits and nothing stops them, which is a real choice and also
				what leaving the boxes unticked gives you.
			</Alert>
		{/if}

		<section class="flex flex-col gap-4">
			<SectionHeading level={2}>Quotas</SectionHeading>
			{#if data.quotas.length === 0}
				<EmptyState
					title="No quota is set"
					description="Every tenant may use as much as it likes."
				>
					{#snippet iconSnippet()}
						<Gauge size={ICON.lg} />
					{/snippet}
				</EmptyState>
			{:else}
				<Table label="Quotas">
					<thead>
						<tr>
							<th scope="col">Tenant</th>
							<th scope="col">API calls</th>
							<th scope="col">Storage</th>
							<th scope="col">Bandwidth</th>
							<th scope="col">Enforcement</th>
							<th scope="col"><span class="sr-only">Actions</span></th>
						</tr>
					</thead>
					<tbody>
						{#each data.quotas as q (q.id)}
							{@const used = usageByTenant.get(q.tenant_id)}
							{@const callPct = used ? usedPct(used.api_calls, q.requests_limit) : null}
							{@const storePct = used ? usedPct(used.storage_bytes, q.storage_bytes_limit) : null}
							{@const bandPct = used ? usedPct(used.bandwidth_bytes, q.bandwidth_bytes_limit) : null}
							<tr>
								<td data-cell="nowrap">
									<span class="font-medium text-fg">{q.tenant_id}</span>
									{#if q.blocked_at}
										<Badge tone="danger" dot>Blocked</Badge>
									{/if}
									{#if uncheckedDimensions(q).length > 0}
										<!-- Zero reads like the strictest setting and is the
										     loosest: that dimension is not checked at all. -->
										<div class="text-xs text-faint">
											Unchecked: {uncheckedDimensions(q).join(', ')}
										</div>
									{/if}
								</td>
								<td data-cell="nowrap">
									<Badge tone={usageTone(callPct)}>
										{callPct === null ? limitLabel(q.requests_limit) : `${callPct}%`}
									</Badge>
									{#if used}
										<div class="text-xs text-faint">
											{formatCount(used.api_calls)} used
										</div>
									{/if}
								</td>
								<td data-cell="nowrap">
									<Badge tone={usageTone(storePct)}>
										{storePct === null ? limitLabel(q.storage_bytes_limit, true) : `${storePct}%`}
									</Badge>
									{#if used}
										<div class="text-xs text-faint">{bytes(used.storage_bytes)} used</div>
									{/if}
								</td>
								<td data-cell="nowrap">
									<Badge tone={usageTone(bandPct)}>
										{bandPct === null
											? limitLabel(q.bandwidth_bytes_limit, true)
											: `${bandPct}%`}
									</Badge>
									{#if used}
										<div class="text-xs text-faint">{bytes(used.bandwidth_bytes)} used</div>
									{/if}
								</td>
								<td data-cell="nowrap">
									<Badge tone={enforcementTone(q)}>{enforcementLabel(q)}</Badge>
								</td>
								<td class="text-right">
									<Button variant="ghost" size="sm" onclick={() => openQuota(q)} aria-label="Edit the quota for {q.tenant_id}">
										<Pencil size={ICON.sm} />
									</Button>
								</td>
							</tr>
						{/each}
					</tbody>
				</Table>
				<Pagination
					page={pageNumber(data.offset, data.limit)}
					perPage={data.limit}
					count={data.quotas.length}
					total={data.quotaTotal ?? undefined}
					noun="quotas"
					href={pageHref('/admin/tenants/usage', data.limit)}
				/>
			{/if}
		</section>

		<section class="flex flex-col gap-4">
			<SectionHeading level={2}>Requests for more</SectionHeading>
			{#if !data.requestsRead}
				<Alert tone="danger">
					The requests could not be read. This is not a report that nobody is waiting.
				</Alert>
			{:else if waiting.length === 0}
				<EmptyState
					title="Nobody is waiting"
					description="No tenant has asked for a higher limit."
				>
					{#snippet iconSnippet()}
						<Check size={ICON.lg} />
					{/snippet}
				</EmptyState>
			{:else}
				<Table label="Requests for more">
					<thead>
						<tr>
							<th scope="col">Tenant</th>
							<th scope="col">Asking for</th>
							<th scope="col">Because</th>
							<th scope="col">Raised</th>
							<th scope="col"><span class="sr-only">Actions</span></th>
						</tr>
					</thead>
					<tbody>
						{#each waiting as r (r.id)}
							<tr>
								<td data-cell="nowrap">
									<span class="font-medium text-fg">{r.tenant_id}</span>
									<div class="text-xs text-faint">by {r.requested_by}</div>
								</td>
								<td class="text-xs text-faint">
									{#if r.requests_limit}
										<div>{formatCount(r.requests_limit)} API calls</div>
									{/if}
									{#if r.storage_bytes_limit}
										<div>{bytes(r.storage_bytes_limit)} storage</div>
									{/if}
									{#if r.bandwidth_bytes_limit}
										<div>{bytes(r.bandwidth_bytes_limit)} bandwidth</div>
									{/if}
								</td>
								<td class="max-w-sm text-xs text-faint">{r.reason}</td>
								<td data-cell="nowrap" class="text-xs text-faint">
									{formatDateTime(r.created_at)}
								</td>
								<td data-cell="nowrap">
									<div class="flex items-center justify-end gap-1">
										<form method="POST" action="?/review" use:enhance={review(r, 'approve')}>
											<input type="hidden" name="id" value={r.id} />
											<input type="hidden" name="decision" value="approve" />
											<Button
												variant="ghost"
												size="sm"
												type="submit"
												aria-label="Approve the request from {r.tenant_id}"
											>
												<Check size={ICON.sm} class="text-success" />
											</Button>
										</form>
										<form method="POST" action="?/review" use:enhance={review(r, 'deny')}>
											<input type="hidden" name="id" value={r.id} />
											<input type="hidden" name="decision" value="deny" />
											<Button
												variant="ghost"
												size="sm"
												type="submit"
												aria-label="Deny the request from {r.tenant_id}"
											>
												<X size={ICON.sm} class="text-danger" />
											</Button>
										</form>
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

<Drawer bind:open={editorOpen} title={editing ? `Quota for ${editing.tenant_id}` : 'New quota'}>
	<form method="POST" action="?/quota" id="quota-form" use:enhance={saveQuota.enhance} class="flex flex-col gap-4">
		<FormErrors message={formError || undefined} fields={errors} {refused} />
		{#if editing}
			<input type="hidden" name="tenant_id" value={editing.tenant_id} />
		{:else}
			<Input id="quota-tenant" name="tenant_id" label="Tenant" required bind:value={tenantId} error={errors.tenant_id} placeholder="acme" />
		{/if}
		<p class="text-xs text-muted">0 leaves a dimension unchecked.</p>
		<NumberInput id="quota-requests" name="requests_limit" label="API calls a month" min={0} bind:value={requestsLimit} />
		<div class="grid gap-4 sm:grid-cols-2">
			<NumberInput id="quota-storage" name="storage_gib" label="Storage (GB)" min={0} bind:value={storageGib} />
			<NumberInput id="quota-bandwidth" name="bandwidth_gib" label="Bandwidth a month (GB)" min={0} bind:value={bandwidthGib} />
		</div>
		<input type="hidden" name="is_hard_limit" value={hardLimit ? 'true' : 'false'} />
		<Toggle id="quota-hard" label="Hard limit" hint="Off, the limits are reported and never enforced." bind:checked={hardLimit} />
		<input type="hidden" name="block_on_exceeded" value={blockOnExceeded ? 'true' : 'false'} />
		<Toggle id="quota-block" label="Block the tenant past a limit" bind:checked={blockOnExceeded} />
		<NumberInput id="quota-grace" name="grace_period_hours" label="Grace period (hours)" min={0} bind:value={graceHours} hint="How long a tenant may stay over before the block." />
		<input type="hidden" name="warn_at_pct_80" value={warn80 ? 'true' : 'false'} />
		<Toggle id="quota-warn80" label="Warn at 80%" bind:checked={warn80} />
		<input type="hidden" name="warn_at_pct_90" value={warn90 ? 'true' : 'false'} />
		<Toggle id="quota-warn90" label="Warn at 90%" bind:checked={warn90} />
	</form>
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (editorOpen = false)}>Cancel</Button>
		{#if editing}
			<Button variant="danger" onclick={askClear}>Delete</Button>
		{/if}
		<Button variant="primary" type="submit" form="quota-form" disabled={!editing && !tenantId.trim()} loading={saveQuota.pending}>
			{editing ? 'Save' : 'Create'}
		</Button>
	{/snippet}
</Drawer>

<form method="POST" action="?/clearQuota" use:enhance bind:this={clearForm} class="hidden">
	<input type="hidden" name="tenant_id" value={editing?.tenant_id ?? ''} />
</form>
