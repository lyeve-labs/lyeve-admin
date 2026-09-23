<script lang="ts">
	import PageTitle from '$lib/components/PageTitle.svelte';
	import {
		Alert,
		Badge,
		Button,
		Drawer,
		EmptyState,
		Input,
		PageShell,
		SectionHeading,
		Select,
		Stat,
		Table,
		Textarea,
		Toggle,
		confirm as confirmDialog,
		toast,
	} from '@lyeve-labs/ui-kit';
	import { enhance } from '$app/forms';
	import { tracked } from '$lib/forms.svelte';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { Gauge, Plus, SplitSquareHorizontal, Trash2 } from '@lucide/svelte';
	import {
		METRIC_TYPES,
		STATUS_LABELS,
		hasWinner,
		pValue,
		ratePercent,
		splitIsSound,
		splitTotal,
		statusTone,
		totalSample,
		underpowered,
		verdict,
		type Metric,
		type Variant,
	} from '$lib/api/ab-testing';
	import { NO_VALUE } from '$lib/format';
	import type { ActionData, PageData } from './$types';
	import { ICON } from '$lib/icon';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const formError = $derived((form as { error?: string } | null)?.error ?? '');
	const exp = $derived(data.experiment);
	const soundSplit = $derived(splitIsSound(data.variants));
	const thin = $derived(underpowered(exp, data.results));

	let addingVariant = $state(false);
	let variantName = $state('');
	let variantDescription = $state('');
	let variantConfig = $state('');
	let variantShare = $state('50');
	let variantIsControl = $state(false);

	let addingMetric = $state(false);
	let metricName = $state('');
	let metricDescription = $state('');
	let metricEvent = $state('');
	let metricKind = $state('conversion');

	function openVariant() {
		variantName = '';
		variantDescription = '';
		variantConfig = '';
		// What is left of a hundred, so a second variant defaults to completing
		// the split rather than to a number somebody has to work out.
		variantShare = String(Math.max(0, Math.round((100 - splitTotal(data.variants)) * 10) / 10));
		variantIsControl = data.variants.length === 0;
		addingVariant = true;
	}

	function openMetric() {
		metricName = '';
		metricDescription = '';
		metricEvent = '';
		metricKind = 'conversion';
		addingMetric = true;
	}

	const saveVariant: SubmitFunction = () => {
		const subject = variantName;
		return async ({ result, update }) => {
			if (result.type !== 'failure') addingVariant = false;
			await update();
			if (result.type === 'success') toast.success(`Added ${subject}`);
		};
	};

	const saveMetric: SubmitFunction = () => {
		const subject = metricName;
		return async ({ result, update }) => {
			if (result.type !== 'failure') addingMetric = false;
			await update();
			if (result.type === 'success') toast.success(`Added ${subject}`);
		};
	};

	function removeVariant(v: Variant): SubmitFunction {
		return async ({ cancel }) => {
			const confirmed = await confirmDialog(
				`Remove ${v.name}?`,
				'Exposures already recorded against it stay, so the results keep counting people who saw it.',
				{ confirmLabel: 'Remove' },
			);
			if (!confirmed) {
				cancel();
				return;
			}
			return async ({ result, update }) => {
				await update();
				if (result.type === 'success') toast.success(`Removed ${v.name}`);
			};
		};
	}

	function removeMetric(m: Metric): SubmitFunction {
		return async ({ cancel }) => {
			const confirmed = await confirmDialog(`Remove ${m.name}?`, 'The events it counted stay recorded.', {
				confirmLabel: 'Remove',
			});
			if (!confirmed) {
				cancel();
				return;
			}
			return async ({ result, update }) => {
				await update();
				if (result.type === 'success') toast.success(`Removed ${m.name}`);
			};
		};
	}

	const saveVariantSubmit = tracked(saveVariant);
	const saveMetricSubmit = tracked(saveMetric);
</script>

<PageTitle title={exp.name} />

<PageShell
	title={exp.name}
	description={exp.description || 'No description was written for this experiment.'}
	width="wide"
	back={{ href: '/admin/experiments', label: 'Experiments' }}
>
	{#snippet actions()}
		<Badge tone={statusTone(exp.status)} dot>{STATUS_LABELS[exp.status]}</Badge>
	{/snippet}

	{#if formError}
		<Alert tone="danger">{formError}</Alert>
	{/if}

	<section class="flex flex-col gap-4">
		<SectionHeading level={2}>What the results support</SectionHeading>
		<!-- The sentence, not the number. "Not significant" is the most misread
		     result in the product: it is not a tie, it is an experiment that has
		     not answered, and reading it as a tie ships changes on noise. -->
		<Alert tone={hasWinner(data.results) ? 'success' : 'brand'}>
			{verdict(data.results)}
		</Alert>

		{#if thin}
			<Alert tone="warn">
				At least one variant has fewer than {exp.min_sample_size} exposures, which is the minimum
				this experiment set for itself. Whatever the p-value says, the result is not yet worth
				acting on.
			</Alert>
		{/if}

		<div class="grid gap-4 sm:grid-cols-3">
			<Stat size="sm" mono label="Exposures" value={totalSample(data.results)} />
			<Stat size="sm" mono label="Variants" value={data.variants.length} />
			<Stat size="sm" mono label="Metrics" value={data.metrics.length} />
		</div>

		{#if data.results && data.results.variants.length > 0}
			<Table label="What the results support">
				<thead>
					<tr>
						<th scope="col">Variant</th>
						<th scope="col">Exposed</th>
						<th scope="col">Converted</th>
						<th scope="col">Rate</th>
						<th scope="col">Confidence</th>
					</tr>
				</thead>
				<tbody>
					{#each data.results.variants as v (v.variant_id)}
						<tr>
							<td data-cell="nowrap">
								<span class="font-medium text-fg">{v.variant_name}</span>
								{#if v.is_control}
									<Badge tone="neutral">Control</Badge>
								{/if}
								{#if hasWinner(data.results) && data.results.winner === v.variant_name}
									<Badge tone="success">Ahead</Badge>
								{/if}
							</td>
							<td data-cell="nowrap" class="font-mono text-xs">{v.sample_size}</td>
							<td data-cell="nowrap" class="font-mono text-xs">{v.conversions}</td>
							<td data-cell="nowrap" class="font-mono text-xs">{ratePercent(v.conversion_rate)}</td>
							<td data-cell="nowrap" class="text-xs text-faint">{pValue(v.p_value)}</td>
						</tr>
					{/each}
				</tbody>
			</Table>
		{/if}
	</section>

	<section class="flex flex-col gap-4">
		<SectionHeading level={2}>Variants</SectionHeading>
		{#if !soundSplit && data.variants.length > 0}
			<!-- Each variant carries its own percentage and nothing reconciles them,
			     so a split of 60/60 is storable and means whatever the bucketing
			     does with it. Nothing else in the product says so. -->
			<Alert tone="warn">
				The shares add up to {splitTotal(data.variants)}%, not 100%. Traffic is still split, but
				not in the proportions written here.
			</Alert>
		{/if}

		{#if data.variants.length === 0}
			<EmptyState
				title="No variant yet"
				description="An experiment with no variants splits nothing. Add a control and at least one alternative."
			>
				{#snippet iconSnippet()}
					<SplitSquareHorizontal size={ICON.lg} />
				{/snippet}
				{#snippet action()}
					<Button variant="secondary" onclick={openVariant}>
						<Plus size={ICON.sm} /> New variant
					</Button>
				{/snippet}
			</EmptyState>
		{:else}
			<Table label="Variants">
				<thead>
					<tr>
						<th scope="col">Variant</th>
						<th scope="col">Share</th>
						<th scope="col">Config</th>
						<th scope="col"><span class="sr-only">Actions</span></th>
					</tr>
				</thead>
				<tbody>
					{#each data.variants as v (v.id)}
						<tr>
							<td data-cell="nowrap">
								<span class="font-medium text-fg">{v.name}</span>
								{#if v.is_control}
									<Badge tone="neutral">Control</Badge>
								{/if}
								{#if v.description}
									<div class="text-xs text-faint">{v.description}</div>
								{/if}
							</td>
							<td data-cell="nowrap" class="font-mono text-xs">{v.traffic_percentage}%</td>
							<td class="max-w-sm truncate font-mono text-xs text-faint" title={v.config}>
								{v.config || NO_VALUE}
							</td>
							<td data-cell="nowrap">
								<div class="flex justify-end">
									<form method="POST" action="?/removeVariant" use:enhance={removeVariant(v)}>
										<input type="hidden" name="vid" value={v.id} />
										<Button variant="ghost" size="sm" type="submit" aria-label="Remove {v.name}">
											<Trash2 size={ICON.sm} class="text-danger" />
										</Button>
									</form>
								</div>
							</td>
						</tr>
					{/each}
				</tbody>
			</Table>
			<div>
				<Button variant="secondary" size="sm" onclick={openVariant}>
					<Plus size={ICON.sm} /> New variant
				</Button>
			</div>
		{/if}
	</section>

	<section class="flex flex-col gap-4">
		<SectionHeading level={2}>Metrics</SectionHeading>
		{#if data.metrics.length === 0}
			<EmptyState
				title="No metric yet"
				description="Nothing is being counted, so this experiment can never produce a result."
			>
				{#snippet iconSnippet()}
					<Gauge size={ICON.lg} />
				{/snippet}
				{#snippet action()}
					<Button variant="secondary" onclick={openMetric}>
						<Plus size={ICON.sm} /> New metric
					</Button>
				{/snippet}
			</EmptyState>
		{:else}
			<Table label="Metrics">
				<thead>
					<tr>
						<th scope="col">Metric</th>
						<th scope="col">Counts the event</th>
						<th scope="col">Type</th>
						<th scope="col"><span class="sr-only">Actions</span></th>
					</tr>
				</thead>
				<tbody>
					{#each data.metrics as m (m.id)}
						<tr>
							<td data-cell="nowrap">
								<span class="font-medium text-fg">{m.name}</span>
								{#if m.description}
									<div class="text-xs text-faint">{m.description}</div>
								{/if}
							</td>
							<td data-cell="nowrap" class="font-mono text-xs">{m.event_name}</td>
							<td data-cell="nowrap" class="text-xs text-faint">{m.metric_type}</td>
							<td data-cell="nowrap">
								<div class="flex justify-end">
									<form method="POST" action="?/removeMetric" use:enhance={removeMetric(m)}>
										<input type="hidden" name="mid" value={m.id} />
										<Button variant="ghost" size="sm" type="submit" aria-label="Remove {m.name}">
											<Trash2 size={ICON.sm} class="text-danger" />
										</Button>
									</form>
								</div>
							</td>
						</tr>
					{/each}
				</tbody>
			</Table>
			<div>
				<Button variant="secondary" size="sm" onclick={openMetric}>
					<Plus size={ICON.sm} /> New metric
				</Button>
			</div>
		{/if}
	</section>
</PageShell>

<Drawer bind:open={addingVariant} title="New variant">
	<form id="variant-form" method="POST" action="?/addVariant" use:enhance={saveVariantSubmit.enhance}>
		<div class="flex flex-col gap-4">
			<Input id="variant-name" name="name" label="Name" bind:value={variantName} required />
			<Input
				id="variant-share"
				name="traffic_percentage"
				label="Share of traffic, as a percentage"
				hint="The shares across every variant should come to 100."
				bind:value={variantShare}
			/>
			<Textarea
				id="variant-description"
				name="description"
				label="What is different about it"
				rows={2}
				bind:value={variantDescription}
			/>
			<Textarea
				id="variant-config"
				name="config"
				label="Config the application reads"
				hint="Handed back to whatever asks which variant a person is in."
				rows={3}
				bind:value={variantConfig}
			/>
			<input type="hidden" name="is_control" value={variantIsControl ? 'true' : 'false'} />
			<Toggle
				id="variant-control"
				label="This is the control"
				hint="The baseline every other variant is compared against."
				bind:checked={variantIsControl}
			/>
		</div>
	</form>
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (addingVariant = false)}>Cancel</Button>
		<Button variant="primary" type="submit" form="variant-form" loading={saveVariantSubmit.pending}>Create</Button>
	{/snippet}
</Drawer>

<Drawer bind:open={addingMetric} title="New metric">
	<form id="metric-form" method="POST" action="?/addMetric" use:enhance={saveMetricSubmit.enhance}>
		<div class="flex flex-col gap-4">
			<Input id="metric-name" name="name" label="Name" bind:value={metricName} required />
			<Input
				id="metric-event"
				name="event_name"
				label="Event name"
				hint="Exactly what the application sends. A mismatch counts nothing and reports no error."
				bind:value={metricEvent}
				required
			/>
			<Select
				id="metric-type"
				name="metric_type"
				label="Type"
				bind:value={metricKind}
				options={METRIC_TYPES.map((t) => ({ value: t, label: t }))}
			/>
			<Textarea
				id="metric-description"
				name="description"
				label="What it means"
				rows={2}
				bind:value={metricDescription}
			/>
		</div>
	</form>
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (addingMetric = false)}>Cancel</Button>
		<Button variant="primary" type="submit" form="metric-form" loading={saveMetricSubmit.pending}>Create</Button>
	{/snippet}
</Drawer>
