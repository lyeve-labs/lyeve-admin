<script lang="ts">
	/*
	 * What one mapping does to a cell before it is stored, with the options
	 * the chosen transform needs. Used by the import wizard and the mapping
	 * template drawer, so a transform reads the same in both.
	 */
	import { Input, Select, Textarea } from '@lyeve-labs/ui-kit';
	import { TRANSFORMS, type TransformDraft } from '$lib/api/bulk-import';

	let {
		draft = $bindable(),
		id,
		label,
		licensed = null,
	}: {
		draft: TransformDraft;
		/** A prefix that keeps each field's id unique on the page. */
		id: string;
		label: string;
		/** False marks the transforms this install may not name in a new request. */
		licensed?: boolean | null;
	} = $props();

	const options = $derived(
		TRANSFORMS.map((t) => ({
			value: t.value,
			label: t.licensed && licensed === false ? `${t.label}, needs a license` : t.label,
		})),
	);
</script>

<div class="flex flex-col gap-2">
	<Select id="{id}-transform" {label} bind:value={draft.transform} {options} />
	{#if draft.transform === 'date'}
		<div class="grid gap-2 sm:grid-cols-2">
			<Input
				id="{id}-layout"
				label="Written as"
				placeholder="02/01/2006"
				hint="The reference date 2 January 2006, 15:04:05, written the way the cells are."
				bind:value={draft.layout}
			/>
			<Input
				id="{id}-output"
				label="Stored as"
				placeholder="2006-01-02"
				hint="Empty stores the full timestamp."
				bind:value={draft.outputLayout}
			/>
		</div>
	{:else if draft.transform === 'split'}
		<Input
			id="{id}-separator"
			label="Separator"
			hint="Each item is trimmed and an empty one is dropped."
			bind:value={draft.separator}
		/>
	{:else if draft.transform === 'lookup'}
		<Textarea
			id="{id}-lookup"
			label="Lookup"
			rows={4}
			mono
			placeholder={'NY = New York\nCA = California'}
			hint="One pair per line, the value in the file then what to store. At most 1000."
			bind:value={draft.lookup}
		/>
		<Input
			id="{id}-fallback"
			label="For any other value"
			hint="Empty rejects the row, so a value nobody listed is never stored as it is."
			bind:value={draft.fallback}
		/>
	{/if}
</div>
