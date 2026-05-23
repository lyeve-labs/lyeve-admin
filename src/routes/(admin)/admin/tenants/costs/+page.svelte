<script lang="ts">
	import PageTitle from '$lib/components/PageTitle.svelte';
	import {
		Alert,
		Badge,
		Button,
		Card,
		DatePicker,
		Drawer,
		EmptyState,
		Input,
		NumberInput,
		PageShell,
		SectionHeading,
		Select,
		Stat,
		Table,
		confirm as confirmDialog,
	} from '@lyeve-labs/ui-kit';
	import { enhance } from '$app/forms';
	import { Coins, Plus, RefreshCw, RotateCcw, Trash2 } from '@lucide/svelte';
	import type { ActionData, PageData } from './$types';
	import NotEnabled from '$lib/components/NotEnabled.svelte';
	import { submitter } from '$lib/forms.svelte';
	import { BUDGET_PERIODS, RESOURCE_TYPES, type Price, type ResourceType, costShares } from '$lib/api/cost';
	import { formatDate, formatDateTime, NO_VALUE } from '$lib/format';
	import { ICON } from '$lib/icon';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// The tenant list is the super admin's. An admin who can read this page
	// would be sent to a 403 by a way back that names it.
	const back = $derived(
		data.user?.roles?.includes('super_admin') ? { href: '/admin/tenants', label: 'Tenants' } : undefined,
	);

	const submit = submitter(() => (open = false));

	const RESOURCE_LABEL: Record<ResourceType, string> = {
		database: 'Database',
		storage: 'Storage',
		bandwidth: 'Bandwidth',
		compute: 'Compute',
		ai: 'AI',
	};
	const UNIT_LABEL: Record<ResourceType, string> = {
		database: 'units',
		storage: 'bytes held, per month',
		bandwidth: 'bytes transferred',
		compute: 'requests',
		ai: 'tokens',
	};

	function money(amount: string, currency: string): string {
		return currency ? `${amount} ${currency}` : amount;
	}

	// One refusal per form, so a price that was refused does not paint the
	// budget drawer red as well.
	let failure = $derived(
		form && 'error' in form && typeof form.error === 'string' && form.error
			? { form: String(form.form ?? ''), message: form.error, locked: form.locked === true }
			: null,
	);
	let aggregated = $derived(
		form && 'result' in form && form.result && form.form === 'aggregate' ? form.result : null,
	);
	let saved = $derived(form && 'saved' in form && form.saved === true ? String(form.form ?? '') : '');


	// The budget drawer.
	let open = $state(false);
	let budgetName = $state('');
	let budgetAmount = $state('');
	let budgetCurrency = $state('USD');
	let budgetPeriod = $state<string | null>('monthly');
	let budgetResource = $state<string | null>('');
	let budgetThresholds = $state('50, 80, 100');
	let budgetStart = $state('');
	let budgetEnd = $state('');
	let submitting = $state<string | null>(null);

	function openCreate() {
		const now = new Date();
		const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
		const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
		budgetName = '';
		budgetAmount = '';
		budgetCurrency = 'USD';
		budgetPeriod = 'monthly';
		budgetResource = '';
		budgetThresholds = '50, 80, 100';
		budgetStart = first.toISOString().slice(0, 10);
		budgetEnd = last.toISOString().slice(0, 10);
		open = true;
	}

	const periodOptions = BUDGET_PERIODS.map((p) => ({ value: p, label: p[0].toUpperCase() + p.slice(1) }));
	const resourceOptions = [
		{ value: '', label: 'Every resource' },
		...RESOURCE_TYPES.map((r) => ({ value: r, label: RESOURCE_LABEL[r] })),
	];

	// The price rows are edited in place, seeded from what the engine holds
	// and reseeded when a save comes back with new rows.
	type PriceRow = { unit_price: string; per_units: number; currency: string };
	function seed(): Record<ResourceType, PriceRow> {
		const rows = {} as Record<ResourceType, PriceRow>;
		for (const r of RESOURCE_TYPES) {
			const p = data.prices?.find((x) => x.resource_type === r);
			rows[r] = { unit_price: p?.unit_price ?? '0', per_units: p?.per_units ?? 1, currency: p?.currency ?? 'USD' };
		}
		return rows;
	}
	// svelte-ignore state_referenced_locally
	let priceRows = $state<Record<ResourceType, PriceRow>>(seed());
	// svelte-ignore state_referenced_locally
	let seededVersion = version();
	function version(): string {
		return (data.prices ?? []).map((p) => `${p.resource_type}:${p.unit_price}:${p.per_units}:${p.currency}:${p.source}`).join('|');
	}
	$effect(() => {
		const v = version();
		if (v === seededVersion) return;
		seededVersion = v;
		priceRows = seed();
	});

	function priceOf(r: ResourceType): Price | undefined {
		return data.prices?.find((p) => p.resource_type === r);
	}

	let deleteForm = $state<HTMLFormElement | null>(null);
	let deleteId = $state('');

	async function askDelete(id: string, label: string) {
		const ok = await confirmDialog('Delete budget', `Delete ${label}? Its threshold history goes with it.`, {
			confirmLabel: 'Delete',
		});
		if (!ok) return;
		deleteId = id;
		await Promise.resolve();
		deleteForm?.requestSubmit();
	}

	function track(name: string) {
		return () => {
			submitting = name;
			return async ({ update }: { update: (opts?: { reset?: boolean }) => Promise<void> }) => {
				submitting = null;
				await update({ reset: false });
			};
		};
	}
</script>

<PageTitle title="Tenant costs" />

<PageShell
	title="Tenant costs"
	description="What this tenant's usage costs: the ledger the feed fills every hour from the usage and AI meters, the prices it applies, and the budgets held against it."
	width="wide"
	{back}
>
	{#snippet actions()}
		{#if data.enabled}
			<Badge tone="violet" size="sm">Beta</Badge>
			<form method="POST" action="?/aggregate" use:enhance={track('aggregate')}>
				<Button
					type="submit"
					variant="secondary"
					size="sm"
					loading={submitting === 'aggregate'}
					title="Run the feed for this tenant now"
				>
					<RefreshCw size={ICON.sm} /> Aggregate now
				</Button>
			</form>
			<Button variant="primary" size="sm" onclick={openCreate}>
				<Plus size={ICON.sm} /> New budget
			</Button>
		{/if}
	{/snippet}

	{#if !data.enabled}
		<NotEnabled
			title="Tenant costs"
			description="The ledger the feed fills every hour from the usage and AI meters, the prices it applies and the budgets held against it."
			url={data.upgradeUrl}
		/>
	{:else}
		<div class="flex flex-col gap-6">
			{#if aggregated}
				<Alert tone="success" title="The feed ran" autoDismiss>
					{aggregated.entries_saved} cost lines written, {aggregated.budget_events} budget events published,
					{aggregated.anomalies} anomalies opened.
				</Alert>
			{:else if failure?.form === 'aggregate'}
				<Alert tone={failure.locked ? 'warn' : 'danger'}>{failure.message}</Alert>
			{/if}

			<section class="flex flex-col gap-4" aria-label="This month">
				<SectionHeading level={2}>This month</SectionHeading>
				{#if data.summary || data.dashboard}
					<Card>
						<div class="grid gap-6 lg:grid-cols-2">
							<div class="flex flex-col gap-4">
								<Stat
									label="Spend so far"
									value={data.summary ? money(data.summary.total_amount, data.summary.currency) : (data.dashboard?.total_cost_this_month ?? NO_VALUE)}
									mono
								/>
								{#if data.dashboard}
									<div class="grid gap-3 sm:grid-cols-3" data-testid="cost-dashboard">
										<Stat
											label="Budgets at risk"
											value={data.dashboard.budgets_at_risk.length}
											size="sm"
											tone={data.dashboard.budgets_at_risk.length > 0 ? 'warn' : undefined}
										/>
										<Stat
											label="Open anomalies"
											value={data.dashboard.open_anomalies}
											size="sm"
											tone={data.dashboard.open_anomalies > 0 ? 'warn' : undefined}
										/>
										<Stat label="Could save" value={money(data.dashboard.potential_savings, data.summary?.currency ?? '')} size="sm" mono />
									</div>
								{/if}
							</div>
							{#if data.summary}
								<div class="flex flex-col gap-2" data-testid="cost-summary">
									<p class="text-xs font-medium tracking-wide text-faint uppercase">By resource</p>
									<ul class="flex flex-col gap-2">
										{#each costShares(data.summary) as share (share.label)}
											<li class="grid grid-cols-[6rem_minmax(0,1fr)_7rem] items-center gap-3 text-sm">
												<span class="text-muted">{share.label}</span>
												<span class="h-2 overflow-hidden rounded-full bg-surface-2" aria-hidden="true">
													<span class="block h-full rounded-full bg-brand" style="width: {share.percent}%"></span>
												</span>
												<span class="text-right font-mono text-xs text-fg">{money(share.amount, data.summary.currency)}</span>
											</li>
										{/each}
									</ul>
									<p class="text-xs text-faint">From {data.summary.entry_count} cost {data.summary.entry_count === 1 ? 'line' : 'lines'} since the first of the month.</p>
								</div>
							{:else}
								<Alert tone="warn">The split by resource did not answer.</Alert>
							{/if}
						</div>
					</Card>
					{#if data.dashboard && data.dashboard.budgets_at_risk.length > 0}
						<ul class="flex flex-col gap-1 text-sm" aria-label="Budgets at risk">
							{#each data.dashboard.budgets_at_risk as alert (alert.budget_id + ':' + alert.threshold)}
								<li class="flex flex-wrap items-center gap-2">
									<Badge tone={alert.triggered ? 'danger' : 'warn'} size="sm">{alert.threshold}%</Badge>
									<span class="text-fg">{alert.budget_name}</span>
									<span class="font-mono text-xs text-muted">
										{alert.current_spend} of {alert.budget_amount} ({Math.round(alert.spend_percent)}%)
									</span>
								</li>
							{/each}
						</ul>
					{/if}
				{:else}
					<Alert tone="warn">The costs did not answer.</Alert>
				{/if}
			</section>

			<section class="flex flex-col gap-4" aria-label="Budgets">
				<SectionHeading level={2}>Budgets</SectionHeading>
				{#if failure?.form === 'budget'}
					<Alert tone={failure.locked ? 'warn' : 'danger'}>{failure.message}</Alert>
				{:else if saved === 'budget'}
					<Alert tone="success" autoDismiss>Budgets saved.</Alert>
				{/if}
				{#if data.budgets && data.budgets.length > 0}
					<Table label="Budgets">
						<thead>
							<tr>
								<th scope="col">Name</th>
								<th scope="col">Resource</th>
								<th scope="col">Period</th>
								<th scope="col">Amount</th>
								<th scope="col">Spend</th>
								<th scope="col">Window</th>
								<th scope="col">Alerts at</th>
								<th scope="col" class="text-right">Actions</th>
							</tr>
						</thead>
						<tbody>
							{#each data.budgets as budget (budget.id)}
								<tr data-testid="budget-row">
									<td data-cell="nowrap" class="font-medium text-fg">{budget.name}</td>
									<td data-cell="nowrap">{budget.resource_type ? RESOURCE_LABEL[budget.resource_type] : 'Every resource'}</td>
									<td data-cell="nowrap">{budget.period}</td>
									<td data-cell="nowrap" class="font-mono text-xs">{money(budget.amount, budget.currency)}</td>
									<td data-cell="nowrap" class="font-mono text-xs">{budget.current_spend}</td>
									<td data-cell="nowrap" class="text-xs text-muted">
										{formatDate(budget.period_start)} to {formatDate(budget.period_end)}
									</td>
									<td data-cell="nowrap" class="text-xs text-muted">{budget.alert_thresholds.map((t) => `${t}%`).join(', ') || NO_VALUE}</td>
									<td data-cell="nowrap" class="text-right">
										<Button
											variant="ghost"
											size="sm"
											onclick={() => askDelete(budget.id, budget.name)}
											title="Delete"
											aria-label="Delete {budget.name}"
										>
											<Trash2 size={ICON.sm} class="text-danger" />
										</Button>
									</td>
								</tr>
							{/each}
						</tbody>
					</Table>
				{:else if data.budgets}
					<EmptyState
						title="No budget yet"
						description="A budget caps spend over a monthly, quarterly or annual window, for one resource or all of them, and publishes an event when a threshold is crossed."
					>
						{#snippet iconSnippet()}<Coins size={ICON.lg} />{/snippet}
						{#snippet action()}
							<Button variant="secondary" onclick={openCreate}>
								<Plus size={ICON.sm} /> New budget
							</Button>
						{/snippet}
					</EmptyState>
				{:else}
					<Alert tone="warn">The budget list did not answer.</Alert>
				{/if}
			</section>

			<section class="flex flex-col gap-4" aria-label="Prices">
				<SectionHeading level={2}>Prices</SectionHeading>
				<p class="text-sm text-muted">
					What a block of units costs, per resource type. The built-in figures are placeholders to
					replace, not a tariff. A zero on AI means the AI plugin's own per-call estimate is the amount.
				</p>
				{#if failure?.form === 'price'}
					<Alert tone={failure.locked ? 'warn' : 'danger'}>{failure.message}</Alert>
				{:else if saved === 'price'}
					<Alert tone="success" autoDismiss>Price saved.</Alert>
				{/if}
				<div class="grid gap-3 lg:grid-cols-2" data-testid="cost-prices">
					{#each RESOURCE_TYPES as resource (resource)}
						{@const current = priceOf(resource)}
						<Card>
							{#snippet header()}
								<div class="flex items-center justify-between gap-3">
									<SectionHeading level={3}>{RESOURCE_LABEL[resource]}</SectionHeading>
									<Badge tone={current?.source === 'tenant' ? 'brand' : 'neutral'} size="sm">
										{current?.source === 'tenant' ? 'Set by this tenant' : 'Default'}
									</Badge>
								</div>
							{/snippet}
							<form
								method="POST"
								action="?/putPrice"
								use:enhance={track(`price-${resource}`)}
								class="flex flex-col gap-3"
								aria-label="Price for {RESOURCE_LABEL[resource]}"
							>
								<input type="hidden" name="resource_type" value={resource} />
								<fieldset class="flex flex-col gap-3">
									<div class="grid gap-3 sm:grid-cols-3">
										<Input
											id="price-{resource}-unit"
											name="unit_price"
											label="Price"
											bind:value={priceRows[resource].unit_price}
											autocomplete="off"
											mono
										/>
										<NumberInput
											id="price-{resource}-per"
											name="per_units"
											label="Per units"
											hint={UNIT_LABEL[resource]}
											min={1}
											step={1}
											bind:value={priceRows[resource].per_units}
										/>
										<Input
											id="price-{resource}-currency"
											name="currency"
											label="Currency"
											bind:value={priceRows[resource].currency}
											autocomplete="off"
											mono
										/>
									</div>
									<div class="flex items-center gap-2">
										<Button type="submit" variant="primary" size="sm" loading={submitting === `price-${resource}`}>Save</Button>
										{#if current?.source === 'tenant'}
											<Button
												type="submit"
												variant="ghost"
												size="sm"
												formaction="?/resetPrice"
												title="Drop this tenant's price so the default applies"
											>
												<RotateCcw size={ICON.sm} /> Use default
											</Button>
											{#if current.updated_at}
												<span class="text-xs text-faint">Set {formatDateTime(current.updated_at)}</span>
											{/if}
										{/if}
									</div>
								</fieldset>
							</form>
						</Card>
					{/each}
				</div>
			</section>
		</div>
	{/if}
</PageShell>

<Drawer bind:open title="New budget">
	<form
		method="POST"
		action="?/createBudget"
		id="budget-form"
		use:enhance={submit.enhance}
		class="flex flex-col gap-4"
	>
		<input type="hidden" name="period_start" value={budgetStart} />
		<input type="hidden" name="period_end" value={budgetEnd} />
		<Input id="budget-name" name="name" label="Name" required bind:value={budgetName} placeholder="Q4 storage" />
		<div class="grid gap-4 sm:grid-cols-2">
			<Input
				id="budget-amount"
				name="amount"
				label="Amount"
				required
				hint="A decimal, in the currency beside it."
				bind:value={budgetAmount}
				autocomplete="off"
				mono
			/>
			<Input
				id="budget-currency"
				name="currency"
				label="Currency"
				bind:value={budgetCurrency}
				autocomplete="off"
				mono
			/>
		</div>
		<div class="grid gap-4 sm:grid-cols-2">
			<Select
				id="budget-period"
				name="period"
				label="Period"
				options={periodOptions}
				bind:value={budgetPeriod}
			/>
			<Select
				id="budget-resource"
				name="resource_type"
				label="Resource"
				options={resourceOptions}
				bind:value={budgetResource}
			/>
		</div>
		<div class="grid gap-4 sm:grid-cols-2">
			<DatePicker id="budget-start" label="First day" bind:value={budgetStart} required />
			<DatePicker id="budget-end" label="Last day" bind:value={budgetEnd} required />
		</div>
		<Input
			id="budget-thresholds"
			name="alert_thresholds"
			label="Alert thresholds"
			hint="Percentages of the amount, comma separated. Each publishes cost.budget.exceeded once per window."
			bind:value={budgetThresholds}
			autocomplete="off"
			mono
		/>
	</form>
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (open = false)}>Cancel</Button>
		<Button variant="primary" type="submit" form="budget-form" loading={submit.pending}>Create</Button>
	{/snippet}
</Drawer>

<form method="POST" action="?/deleteBudget" use:enhance bind:this={deleteForm} class="hidden">
	<input type="hidden" name="id" value={deleteId} />
</form>
