<script lang="ts">
	import { Alert } from '@lyeve-labs/ui-kit';
	import type { SchemaField, Content } from '@lyeve-labs/client';
	import { fieldKey } from '$lib/utils/content-form';
	import { humanizeFieldName } from '$lib/utils/entry-identity';
	import FieldInput from './FieldInput.svelte';
	import type { MediaChoice } from '$lib/api/media';

	let {
		fields,
		formValues,
		validationErrors = {},
		relationItems = {},
		mediaChoices = [],
		error,
	}: {
		fields: SchemaField[];
		/** Reactive $state proxy from parent - mutated in-place by FieldInput */
		formValues: Record<string, unknown>;
		validationErrors?: Record<string, string>;
		relationItems?: Record<string, Content[]>;
		/** Published library files a media field may point at. */
		mediaChoices?: MediaChoice[];
		/** Server-side error message */
		error?: string | null;
	} = $props();

	/**
	 * How the field's visible label reaches the control FieldInput renders.
	 *
	 * `for` binds a label to a labelable element: a button, an input, a select
	 * or a textarea. Every other control has to carry its own name instead, and
	 * a `for` aimed at one is a label that does nothing when clicked and a
	 * control a screen reader announces unnamed. The two exceptions are the rich
	 * text editor, which is a contenteditable div that names itself, and the
	 * multi-select relation picker, whose trigger is a div holding chips.
	 */
	type Labeling = 'for' | 'self' | 'group';

	function labeling(field: SchemaField): Labeling {
		if (field.field_type === 'rich_text') return 'self';
		if (
			field.field_type === 'relation' &&
			(field.relation_type === 'has_many' || field.relation_type === 'many_to_many')
		) {
			return 'group';
		}
		return 'for';
	}

	/**
	 * The element a `for` label points at. A datetime is one kit field holding
	 * a date trigger and a time half, and its label opens the calendar, so it
	 * names the trigger the field derives from its id.
	 */
	function labelTarget(field: SchemaField): string {
		return field.field_type === 'datetime' ? `field-${field.name}-date` : `field-${field.name}`;
	}

	/** "first_name" reads "First name", the case every other field label uses. */
	function fieldLabel(name: string): string {
		const words = humanizeFieldName(name);
		return words.charAt(0) + words.slice(1).toLowerCase();
	}
</script>

{#if fields.length === 0}
	<p class="text-faint text-sm py-4 text-center">This schema has no editable fields.</p>
{:else}
	<!-- The form states the gap between its fields. The caller's Card wraps
	     its children, so a space-y on the Card would not reach them. -->
	<div class="flex flex-col gap-5">
	{#each fields as field (field.name)}
		{@const bind = labeling(field)}
		<div
			class="flex flex-col gap-1.5"
			data-field-name={field.name}
			data-field-type={field.field_type}
			data-relation-type={field.relation_type ?? undefined}
		>
			<!-- The label every other form in the console carries: sentence case,
			     body size, the required marker after it. The kit's Label is the
			     uppercase caption style, and with the field type in brackets
			     after the raw column name it would read "NAME (text)". -->
			<label for={bind === 'for' ? labelTarget(field) : undefined} class="text-sm font-medium text-fg">
				{fieldLabel(field.name)}{#if field.required}<span class="text-danger ms-0.5" aria-hidden="true">*</span>{/if}
			</label>

			{#if bind === 'group'}
				<div role="group" aria-label={field.name}>
					<FieldInput
						{field}
						id="field-{field.name}"
						bind:value={formValues[field.name]}
						relationItems={relationItems[field.relation_to ?? ''] ?? []}
						{mediaChoices}
						error={validationErrors[field.name]}
					/>
				</div>
			{:else}
				<!-- The message goes to the control, which owns aria-invalid and the
				     paragraph its aria-describedby already points at. Printed here it
				     would be a loose paragraph with no id that nothing references. -->
				<!-- Bound by the key the form state uses, which for a belongs_to is
				     the foreign key column and not the field name. Bound by name,
				     a belongs_to would start undefined, which Svelte refuses for a
				     prop with a fallback. -->
				<FieldInput
					{field}
					id="field-{field.name}"
					bind:value={formValues[fieldKey(field)]}
					relationItems={relationItems[field.relation_to ?? ''] ?? []}
					{mediaChoices}
					error={validationErrors[field.name]}
				/>
			{/if}
		</div>
	{/each}
	</div>
{/if}

{#if error}
	<Alert tone="danger" class="mt-2">{error}</Alert>
{/if}
