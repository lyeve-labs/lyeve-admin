<script lang="ts">
	import {
		Autocomplete,
		Checkbox,
		DatePicker,
		DateTimePicker,
		Input,
		MultiSelect,
		NumberInput,
		Textarea,
	} from '@lyeve-labs/ui-kit';
	import type { SchemaField, Content } from '@lyeve-labs/client';
	import { entryLabel } from '$lib/utils/entry-identity';
	import RichTextEditor from './RichTextEditor.svelte';
	import JsonFieldEditor from './JsonFieldEditor.svelte';
	import MediaPicker from './media/MediaPicker.svelte';
	import type { MediaChoice } from '$lib/api/media';

	type InputEv = Event & { currentTarget: HTMLInputElement };
	type TextareaEv = Event & { currentTarget: HTMLTextAreaElement };

	let {
		field,
		value = $bindable<unknown>(''),
		relationItems = [],
		mediaChoices = [],
		id,
		error,
	}: {
		field: SchemaField;
		value?: unknown;
		/** Items from the related schema, for relation-type fields */
		relationItems?: Content[];
		/** Published library files, offered by a media field's picker. */
		mediaChoices?: MediaChoice[];
		/**
		 * The id the field's own <Label for=...> points at. Every branch below
		 * puts it on the control it renders, so the label names the control.
		 */
		id?: string;
		/**
		 * The field's validation message. Handed to the control rather than
		 * printed beside it, so it reaches aria-invalid and the paragraph the
		 * control already wires with aria-describedby. Printed alongside, it
		 * would be an unreferenced paragraph that a screen reader never reaches.
		 */
		error?: string;
	} = $props();

	// A relation option's name, resolved the same way a listing row's is.
	let relationOptions = $derived(
		relationItems.map((item) => ({ value: item.id, label: entryLabel(item) })),
	);

	let selectedIds = $derived(
		Array.isArray(value) ? (value as unknown[]).map(String).filter(Boolean) : [],
	);

	/**
	 * The rows an inverse relation resolves to, by label where the picker's
	 * items know them and by id where they do not. A populated read hands the
	 * rows themselves. The admin entry hands ids or nothing.
	 */
	let inverseLabels = $derived.by(() => {
		const rows = Array.isArray(value) ? value : value ? [value] : [];
		return rows.map((row) => {
			if (row && typeof row === 'object') return entryLabel(row as Content);
			const found = relationItems.find((item) => item.id === String(row));
			return found ? entryLabel(found) : String(row);
		});
	});

	/**
	 * A number field holds a number or nothing, and NumberInput has no empty
	 * state to show, so an unset optional number reads as zero until it is
	 * touched. The form value is left alone until the operator changes it, so an
	 * untouched blank still serializes to null rather than to a zero nobody
	 * typed.
	 */
	let numberValue = $derived(typeof value === 'number' ? value : Number(value) || 0);

	// A datetime is the local wall clock the form utilities convert to and from
	// the stored UTC instant. The kit's DateTimePicker reads minutes or seconds
	// and nothing finer, so a stored fraction is dropped from what it is shown.
	// The value itself changes only when the operator edits the field.
	let dateTimeValue = $derived(String(value ?? '').replace(/\.\d+$/, ''));
	let dateTimeSeconds = $derived(/T\d{2}:\d{2}:\d{2}$/.test(dateTimeValue));

	// The form state holds a json field as text. A value loaded as an object
	// is shown as the text it saves as.
	const jsonText = $derived(
		typeof value === 'string' ? value : value === null || value === undefined ? '' : JSON.stringify(value, null, 2),
	);

</script>

{#if field.field_type === 'rich_text'}
	<RichTextEditor bind:value={value as string} required={field.required} {id} label={field.name} />
	{#if error}
		<!-- TipTap edits a contenteditable div and takes no describedby of its
		     own, so this paragraph carries the id the control would point at. -->
		<p id={id ? `${id}-error` : undefined} class="text-xs text-danger">{error}</p>
	{/if}

{:else if field.field_type === 'boolean'}
	<!-- A checkbox, not a switch: `<label for>` binds to it, so the field's own
	     label names it and clicking that label toggles the value. A div is not
	     a labelable element, so a switch wrapped in one would leave the label
	     pointing at nothing. -->
	<Checkbox
		{id}
		{error}
		checked={Boolean(value)}
		label={field.name}
		labelHidden
		required={field.required}
		onchange={(checked: boolean) => { value = checked; }}
	/>

{:else if field.field_type === 'json'}
	<JsonFieldEditor
		{id}
		{error}
		bind:value={() => jsonText, (next: string) => { value = next; }}
		required={field.required}
	/>

{:else if field.field_type === 'relation'}
	{#if field.relation_type === 'has_one' || field.relation_type === 'has_many'}
		<!-- The key lives on the other table, so nothing typed here can be
		     saved: a has_one value would go to the insert as a column that
		     does not exist, and a has_many selection never reaches the
		     request. What can be shown is what points here. -->
		<div {id} class="rounded-md border border-line bg-surface-2 px-3 py-2 text-sm" data-testid="inverse-relation">
			{#if inverseLabels.length > 0}
				<ul class="space-y-0.5 text-fg">
					{#each inverseLabels as label (label)}
						<li>{label}</li>
					{/each}
				</ul>
			{:else}
				<p class="text-faint">Nothing points here yet.</p>
			{/if}
			<p class="mt-1 text-xs text-faint">
				Read from <code class="text-muted">{field.relation_to}</code>, which holds the key.
				Set it on that entry, not here.
			</p>
		</div>
	{:else if field.relation_type === 'many_to_many'}
		{#if relationItems.length > 0}
			<MultiSelect
				{id}
				{error}
				value={selectedIds}
				options={relationOptions}
				placeholder="Select {field.relation_to ?? 'entries'}"
				required={field.required}
				onchange={(ids: string[]) => { value = ids; }}
			/>
		{:else}
			<p class="text-xs text-faint italic">
				No entries found in <code class="text-muted">{field.relation_to}</code>.
			</p>
		{/if}
	{:else if relationItems.length > 0}
		<!-- A combobox, not a select. The picker is fed up to 500 rows, and a
		     native option list of that length can only be scrolled. -->
		<Autocomplete
			{id}
			{error}
			value={String(value ?? '')}
			options={relationOptions}
			placeholder="Search {field.relation_to ?? 'entries'}"
			required={field.required}
			onchange={(next: string) => { value = next || null; }}
		/>
	{:else}
		<Input
			{id}
			{error}
			type="text"
			value={String(value ?? '')}
			oninput={(e: InputEv) => { value = e.currentTarget.value; }}
			placeholder="Enter related item ID (UUID)"
			hint="No entries found in {field.relation_to}. Enter an ID manually."
			required={field.required}
		/>
	{/if}

{:else if field.field_type === 'number'}
	<NumberInput
		{id}
		{error}
		value={numberValue}
		required={field.required}
		onchange={(next: number) => { value = next; }}
	/>

{:else if field.field_type === 'date'}
	<DatePicker
		{id}
		{error}
		value={String(value ?? '')}
		required={field.required}
		onchange={(next: string) => { value = next || null; }}
	/>

{:else if field.field_type === 'datetime'}
	<DateTimePicker
		{id}
		{error}
		value={dateTimeValue}
		seconds={dateTimeSeconds}
		required={field.required}
		onchange={(next: string) => { value = next || null; }}
	/>

{:else if field.field_type === 'email'}
	<Input
		{id}
		{error}
		type="email"
		value={String(value ?? '')}
		oninput={(e: InputEv) => { value = e.currentTarget.value; }}
		placeholder="user@example.com"
		required={field.required}
		autocomplete="off"
	/>

{:else if field.field_type === 'url'}
	<Input
		{id}
		{error}
		type="url"
		value={String(value ?? '')}
		oninput={(e: InputEv) => { value = e.currentTarget.value; }}
		placeholder="https://"
		required={field.required}
		autocomplete="off"
	/>

{:else if field.field_type === 'media'}
	<!-- A library file is stored by its public path, which a site prefixes
	     with its own address. An outside file by its full URL. -->
	<div class="flex flex-col gap-2">
		<Input
			{id}
			{error}
			value={String(value ?? '')}
			oninput={(e: InputEv) => { value = e.currentTarget.value; }}
			placeholder="/api/v1/media/... or https://example.com/image.jpg"
			hint="Choose a published file from the library, or enter the URL of a file hosted elsewhere."
			required={field.required}
			autocomplete="off"
		/>
		<div>
			<MediaPicker choices={mediaChoices} onpick={(c) => (value = c.public_url)} />
		</div>
	</div>

{:else if field.field_type === 'uid'}
	<!-- The server assigns this, so an editable box would only let an
	     operator type a value the write refuses. -->
	<Input
		{id}
		{error}
		type="text"
		readonly
		value={String(value ?? '')}
		placeholder="Assigned on save"
		hint="The server assigns this identifier. It cannot be edited."
		autocomplete="off"
		mono
	/>

{:else}
	<!-- text and any unknown types -->
	<Input
		{id}
		{error}
		type="text"
		value={String(value ?? '')}
		oninput={(e: InputEv) => { value = e.currentTarget.value; }}
		required={field.required}
		autocomplete="off"
	/>
{/if}
