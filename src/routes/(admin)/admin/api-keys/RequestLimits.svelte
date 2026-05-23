<script lang="ts">
	import { NumberInput } from '@lyeve-labs/ui-kit';
	import { LIMIT_FIELDS, limitOrderProblem, type KeyLimits } from '$lib/api/api-keys';

	/**
	 * A key's three request ceilings side by side, shortest window first, so
	 * the order the engine insists on reads left to right. Each posts under
	 * its own field name.
	 */
	let {
		limits = $bindable(),
		idPrefix,
		errors = {},
	}: {
		limits: KeyLimits;
		idPrefix: string;
		errors?: Record<string, string | undefined>;
	} = $props();

	const order = $derived(limitOrderProblem(limits));
</script>

<fieldset class="flex flex-col gap-2">
	<legend class="text-sm font-medium text-fg">Request limits</legend>
	<div class="grid gap-4 sm:grid-cols-2">
		{#each LIMIT_FIELDS as f (f.field)}
			<NumberInput
				id="{idPrefix}-{f.field}"
				label={f.label}
				name={f.field}
				min={0}
				bind:value={() => limits[f.field], (v) => (limits = { ...limits, [f.field]: v })}
				error={errors[f.field] ?? (order?.field === f.field ? order.message : undefined)}
			/>
		{/each}
	</div>
	<p class="text-xs text-muted">
		0 sets no ceiling. Windows are UTC: the hour resets on the hour, the day at midnight and the month on the first. A key past any of them is answered 429 with a Retry-After until that window ends.
	</p>
</fieldset>
