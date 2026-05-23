<script lang="ts">
	/*
	 * What to export and how, shared by the start and schedule drawers so the
	 * two can never offer different choices. The multi-selects and the
	 * switches submit nothing on their own, so each value rides in a hidden
	 * input the action reads.
	 */
	import { MultiSelect, Select, Textarea, Toggle } from '@lyeve-labs/ui-kit';
	import { FORMATS, FORMAT_LABELS, type ExportFormat } from '$lib/api/data-export';

	let {
		idPrefix,
		schemaNames,
		format = $bindable('json'),
		schemas = $bindable([]),
		statuses = $bindable([]),
		includeSchemas = $bindable(false),
		includeMedia = $bindable(false),
		template = $bindable(''),
	}: {
		idPrefix: string;
		schemaNames: string[];
		format?: string;
		schemas?: string[];
		statuses?: string[];
		includeSchemas?: boolean;
		includeMedia?: boolean;
		template?: string;
	} = $props();

	const formatOptions = FORMATS.map((f) => ({ value: f, label: FORMAT_LABELS[f].label }));
	const schemaOptions = $derived(schemaNames.map((s) => ({ value: s, label: s })));
	const statusOptions = [
		{ value: 'published', label: 'Published' },
		{ value: 'draft', label: 'Draft' },
		{ value: 'archived', label: 'Archived' },
	];
	const formatHint = $derived(FORMAT_LABELS[format as ExportFormat]?.hint ?? '');
	const schemasHint = $derived(
		schemas.length === 0
			? `Every schema${schemaNames.length > 0 ? `, ${schemaNames.length} in this tenant` : ''}.`
			: `${schemas.length} of ${schemaNames.length} schemas.`,
	);
</script>

<div class="flex flex-col gap-4">
	<MultiSelect
		id="{idPrefix}-schemas"
		label="Schemas"
		placeholder="Every schema"
		hint={schemasHint}
		searchable
		options={schemaOptions}
		bind:value={schemas}
	/>
	{#each schemas as s (s)}
		<input type="hidden" name="schemas" value={s} />
	{/each}

	<Select
		id="{idPrefix}-format"
		name="format"
		label="Format"
		hint={formatHint}
		bind:value={format}
		options={formatOptions}
	/>

	{#if format === 'template'}
		<Textarea
			id="{idPrefix}-template"
			name="template"
			label="Template"
			hint="Rendered once per entry. Fields: .Schema, .Slug, .Title, .Body, .Meta, .Status, .PublishedAt, .CreatedAt, .UpdatedAt."
			rows={5}
			bind:value={template}
			required
		/>
	{/if}

	<MultiSelect
		id="{idPrefix}-statuses"
		label="Statuses"
		placeholder="Every status"
		options={statusOptions}
		bind:value={statuses}
	/>
	{#each statuses as s (s)}
		<input type="hidden" name="statuses" value={s} />
	{/each}

	<input type="hidden" name="include_schemas" value={includeSchemas ? 'true' : 'false'} />
	<Toggle
		id="{idPrefix}-include-schemas"
		label="Include the schema definitions"
		hint={format === 'json' || format === 'yaml'
			? 'Written into the document beside the entries.'
			: 'Written to a schemas.json beside the data, so the download is a zip.'}
		bind:checked={includeSchemas}
	/>

	<input type="hidden" name="include_media" value={includeMedia ? 'true' : 'false'} />
	<Toggle
		id="{idPrefix}-include-media"
		label="Bundle referenced media"
		hint="A zip with a folder per entry holding its content and the files it references."
		bind:checked={includeMedia}
	/>
</div>
