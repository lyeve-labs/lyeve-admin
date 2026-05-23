<script lang="ts">
	import PageTitle from '$lib/components/PageTitle.svelte';
	import { Card, Breadcrumb, Button, Label, PageShell, Select } from '@lyeve-labs/ui-kit';
	import type { PageData, ActionData } from './$types';
	import type { SchemaField } from '@lyeve-labs/client';
	import { enhance } from '$app/forms';
	import { Globe } from '@lucide/svelte';
	import { crumbsAfter } from '$lib/breadcrumb';
	import { buildEmpty, validate, serialize, extractM2MRelations } from '$lib/utils/content-form';
	import ContentForm from '$lib/components/ContentForm.svelte';
	import { ICON } from '$lib/icon';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let userFields = $derived(
		(data.schemaDef?.fields ?? []).filter((f: SchemaField) => !f.system),
	);

	// svelte-ignore state_referenced_locally
	let formValues = $state<Record<string, unknown>>(buildEmpty(data.schemaDef?.fields ?? []));
	let validationErrors = $state<Record<string, string>>({});
	let submitting = $state(false);

	// Locale. Default to first locale's code or 'en'
	let locales = $derived(data.locales ?? []);
	// svelte-ignore state_referenced_locally
	let selectedLocale = $state((locales.find((l) => l.is_default) ?? locales[0])?.code ?? 'en');

	let serialized = $derived(() => {
		const base = JSON.parse(serialize(userFields, formValues)) as Record<string, unknown>;
		if (locales.length > 0) base._locale = selectedLocale;
		return JSON.stringify(base);
	});
	let m2mRelations = $derived(JSON.stringify(
		Object.fromEntries(extractM2MRelations(userFields, formValues).map((r) => [r.fieldName, r.ids]))
	));

	function handleSubmit(e: SubmitEvent) {
		const errors = validate(userFields, formValues);
		if (Object.keys(errors).length > 0) {
			e.preventDefault();
			validationErrors = errors;
		}
	}

	let schemaName = $derived(data.schemaDef?.name ?? '');
	let schemaLabel = $derived(data.schemaDef?.display_name || schemaName);

	const back = $derived({ href: `/admin/content/${schemaName}`, label: schemaLabel });
</script>

<PageTitle title="New entry" />

<PageShell
	title="New entry"
	description={`Creating a new ${schemaLabel} entry`}
	width="wide"
	{back}
>
	{#snippet breadcrumb()}
		<Breadcrumb items={crumbsAfter(back, [
			{ label: 'Content', href: '/admin/content' },
			{ label: schemaLabel, href: `/admin/content/${schemaName}` },
			{ label: 'New entry' },
		])} />
	{/snippet}

	{#snippet actions()}
		{#if locales.length > 0}
			<div class="flex items-center gap-2">
				<Globe size={ICON.sm} class="text-muted" />
				<Select
					options={locales.map((l) => ({ value: l.code, label: `${l.name} (${l.code})` }))}
					value={selectedLocale}
					onvaluechange={(v) => (selectedLocale = v)}
				/>
			</div>
		{/if}
	{/snippet}

	<form
		method="POST"
		use:enhance={() => {
			submitting = true;
			return async ({ result, update }) => {
				submitting = false;
				await update();
			};
		}}
		onsubmit={handleSubmit}
	>
		<!-- Serialized data hidden field. Reactive, always current -->
		<input type="hidden" name="data" value={serialized()} />
		<input type="hidden" name="m2m_relations" value={m2mRelations} />

		<Card class="space-y-5">
			<ContentForm
				fields={userFields}
				{formValues}
				{validationErrors}
				relationItems={data.relationItems}
				mediaChoices={data.mediaChoices}
				error={form?.error}
			/>
		</Card>

		<div class="mt-5 flex justify-end">
			<Button type="submit" loading={submitting}>Create</Button>
		</div>
	</form>
</PageShell>
