<script lang="ts">
	/**
	 * The provider fields, shared by create and edit.
	 *
	 * The form is one component so the compatible kind's endpoint fields, the
	 * key placeholder and the private-address rule are stated once. It renders
	 * only the fields, so the owner decides where the buttons go: a drawer
	 * footer on create, a card on the detail page.
	 */
	import { Checkbox, Input, NumberInput, PasswordInput, Select, Toggle } from '@lyeve-labs/ui-kit';
	import { MODALITIES, PRESETS, PROVIDER_KINDS, isCompatibleKind, providerKindLabel, type AiProvider, type Modality, type ProviderKind } from '$lib/api/ai';

	let {
		id,
		provider = null,
		superAdmin,
	}: {
		/** The prefix for every field id, so two forms on one page stay distinct. */
		id: string;
		provider?: AiProvider | null;
		superAdmin: boolean;
	} = $props();

	// svelte-ignore state_referenced_locally
	let kind = $state<ProviderKind>(provider?.kind ?? 'openai');
	let preset = $state('');
	// svelte-ignore state_referenced_locally
	let baseUrl = $state(provider?.base_url ?? '');
	// svelte-ignore state_referenced_locally
	let keyHeader = $state(provider?.key_header ?? '');
	// svelte-ignore state_referenced_locally
	let queryString = $state(provider?.query_string ?? '');
	// svelte-ignore state_referenced_locally
	let allowPrivate = $state(provider?.allow_private ?? false);
	// svelte-ignore state_referenced_locally
	let enabled = $state(provider?.enabled ?? true);
	// svelte-ignore state_referenced_locally
	let modalities = $state<Record<Modality, boolean>>({
		text: provider ? provider.modalities.includes('text') : true,
		embed: provider ? provider.modalities.includes('embed') : true,
		image: provider ? provider.modalities.includes('image') : true,
	});

	const compatible = $derived(isCompatibleKind(kind));
	const anthropicShaped = $derived(kind === 'anthropic_compatible');
	const kindOptions = PROVIDER_KINDS.map((k) => ({ value: k, label: providerKindLabel(k) }));
	const presetOptions = [{ value: '', label: 'None' }, ...PRESETS.map((p) => ({ value: p.id, label: p.label }))];

	// A preset fills what is blank and never overwrites what the operator typed.
	function applyPreset(next: string) {
		preset = next;
		const p = PRESETS.find((x) => x.id === next);
		if (!p) return;
		if (!baseUrl) baseUrl = p.base_url;
		if (!keyHeader) keyHeader = p.key_header;
		if (!queryString) queryString = p.query_string;
	}

	const keyHint = $derived(
		provider?.needs_key
			? 'The stored key could not be read after a key rotation. Enter it again. Nothing else about the row is lost.'
			: provider?.has_key
				? 'A key is stored. Leave this blank to keep it.'
				: compatible
					? 'Optional. A local server usually needs none.'
					: 'Required. It is encrypted at rest and never shown again.'
	);
</script>

<input type="hidden" name="enabled" value={enabled ? 'true' : 'false'} />
<input type="hidden" name="allow_private" value={allowPrivate ? 'true' : 'false'} />

<div class="grid gap-4 md:grid-cols-2">
	<Input id="{id}-name" name="name" label="Name" required value={provider?.name ?? ''} placeholder="openai-primary" />
	<Select
		id="{id}-kind"
		name="kind"
		label="Kind"
		required
		options={kindOptions}
		value={kind}
		onvaluechange={(v) => (kind = v as ProviderKind)}
	/>

	{#if compatible && !anthropicShaped}
		<Select
			id="{id}-preset"
			name="preset"
			label="Preset"
			hint="Fills the base URL and the key header for a server people run. The row stays OpenAI-compatible."
			options={presetOptions}
			value={preset}
			onvaluechange={applyPreset}
		/>
	{/if}
	{#if compatible}
		<Input
			id="{id}-base-url"
			name="base_url"
			label="Base URL"
			required
			bind:value={baseUrl}
			placeholder={anthropicShaped ? 'https://gateway.example.com/anthropic/v1' : 'http://localhost:11434/v1'}
			hint={anthropicShaped
				? 'The root that serves the Anthropic Messages API, the part before /messages.'
				: 'The OpenAI-shaped root the requests are sent to.'}
		/>
		<Input
			id="{id}-key-header"
			name="key_header"
			label="Key header"
			bind:value={keyHeader}
			placeholder={anthropicShaped ? 'x-api-key' : 'Authorization'}
			hint={anthropicShaped
				? 'Blank sends x-api-key, as Anthropic does. A gateway may want Authorization.'
				: 'Blank sends Authorization: Bearer. Azure wants api-key.'}
		/>
		<Input
			id="{id}-query-string"
			name="query_string"
			label="Query string"
			bind:value={queryString}
			placeholder="api-version=2024-10-21"
			hint="Appended to every request. Azure wants api-version."
		/>
	{/if}

	<div class="md:col-span-2">
		<PasswordInput
			id="{id}-key"
			name="api_key"
			label="API key"
			required={!compatible && !provider?.has_key}
			placeholder={provider?.has_key && !provider.needs_key ? 'Stored' : 'sk-'}
			hint={keyHint}
			autocomplete="off"
		/>
	</div>

	<Input
		id="{id}-model"
		name="default_model"
		label="Default model"
		value={provider?.default_model ?? ''}
		placeholder="gpt-4o"
		hint="Used when a call names none."
	/>
	<NumberInput
		id="{id}-priority"
		name="priority"
		label="Priority"
		value={provider?.priority ?? 100}
		min={-1000}
		max={1000}
		hint="Lower is tried first when a call names no provider."
	/>

	<fieldset class="md:col-span-2 flex flex-col gap-2">
		<legend class="text-sm font-medium text-fg">Modalities</legend>
		<div class="flex flex-wrap gap-4">
			{#each MODALITIES as m (m)}
				<Checkbox id="{id}-mod-{m}" name="modalities" value={m} label={m} bind:checked={modalities[m]} />
			{/each}
		</div>
		<p class="text-xs text-faint">What this row may serve. The model's own table decides the rest. A call needs both.</p>
	</fieldset>

	<NumberInput
		id="{id}-rpm"
		name="rate_limit_rpm"
		label="Rate limit"
		value={provider?.rate_limit_rpm ?? 0}
		min={0}
		hint="Requests per minute. 0 is none."
	/>
	<NumberInput
		id="{id}-budget"
		name="max_budget_usd"
		label="Monthly budget"
		value={provider?.max_budget_usd ?? 0}
		min={0}
		step={0.01}
		hint="Dollars per billing period. 0 is none. A call past it answers 402."
	/>

	<div class="md:col-span-2">
		<Toggle id="{id}-enabled" label="Enabled" hint="Off keeps the row and takes it out of routing." bind:checked={enabled} />
	</div>

	{#if compatible && superAdmin}
		<div class="md:col-span-2 flex flex-col gap-2">
			<Toggle
				id="{id}-allow-private"
				label="Allow a private address"
				hint="Off refuses a base URL that resolves to a private, loopback or link-local address."
				bind:checked={allowPrivate}
			/>
			{#if allowPrivate}
				<p class="text-xs text-warn" role="note">
					Requests for this row skip the private-address check, which is how a local Ollama or vLLM is reached.
					Anything on this network the engine can reach, this row can be pointed at. The engine database's own
					address is refused either way. Only a super admin may set this.
				</p>
			{/if}
		</div>
	{/if}
</div>
