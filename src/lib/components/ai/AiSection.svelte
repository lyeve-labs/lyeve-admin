<script lang="ts">
	/**
	 * The tab strip and the gate every AI page renders under.
	 *
	 * The plugin refuses in distinct ways and each tab would otherwise paint
	 * them differently. The page's own load says what its read answered. The
	 * layout says what the settings read answered, which is the one route the
	 * tenant switch leaves open, so it knows the difference between a switch
	 * that is off and a plugin that is not there at all. The layout's word
	 * wins when it is not "ok".
	 *
	 * The off state carries the switch itself: the settings action is what
	 * turns it back on, and a form may post there from any tab.
	 */
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { Alert, Button, EmptyState, Tabs, Toggle } from '@lyeve-labs/ui-kit';
	import { Power, Server } from '@lucide/svelte';
	import type { Snippet } from 'svelte';
	import { effectiveGate, type AiGate } from '$lib/api/ai';
	import NotEnabled from '$lib/components/NotEnabled.svelte';
	import { ICON } from '$lib/icon';

	export type AiTab = 'providers' | 'prompts' | 'transcripts' | 'prices' | 'settings';

	let {
		tab,
		gate,
		layoutGate,
		noun,
		children,
	}: {
		tab: AiTab;
		/** What the page's own read answered. */
		gate: AiGate;
		/** What the settings read answered, from the layout. */
		layoutGate: AiGate;
		/** The resource, in the plural, for the forbidden words. */
		noun: string;
		children: Snippet;
	} = $props();

	const tabs: { id: AiTab; label: string }[] = [
		{ id: 'providers', label: 'Providers' },
		{ id: 'prompts', label: 'Prompts' },
		{ id: 'transcripts', label: 'Transcripts' },
		{ id: 'prices', label: 'Prices' },
		{ id: 'settings', label: 'Settings' },
	];

	const effective = $derived(effectiveGate(gate, layoutGate));
	// The settings tab is the way back from "off", so it never hides behind it.
	const blocked = $derived(effective.state !== 'ok' && !(tab === 'settings' && effective.state === 'off'));

	let switchForm = $state<HTMLFormElement | null>(null);
</script>

<!-- Wrapping, because five tabs on one line are wider than a phone and the
     strip has no scroll box of its own. -->
<Tabs items={tabs} active={tab} onchange={(id) => goto(`/admin/ai/${id}`)} />

{#if !blocked}
	{@render children()}
{:else if effective.state === 'locked'}
	<NotEnabled
		title="AI"
		description="Providers, prompts, transcripts and the editor assistant are part of the AI plugin."
	/>
{:else if effective.state === 'forbidden'}
	<Alert tone="danger" title="Not allowed">Your role cannot read AI {noun}.</Alert>
{:else if effective.state === 'absent'}
	<EmptyState
		title="The AI plugin is not installed"
		description="This instance does not carry the AI plugin, so there is nothing to configure here."
	>
		{#snippet iconSnippet()}
			<Server size={ICON.lg} />
		{/snippet}
	</EmptyState>
{:else if effective.state === 'off'}
	<EmptyState
		title="AI is switched off for this tenant"
		description="Every AI surface on this tenant is off: the providers, the editor assistant, the flow nodes and every call another plugin makes. Nothing is sent anywhere while it is off. The switch is the way back."
	>
		{#snippet iconSnippet()}
			<Power size={ICON.lg} />
		{/snippet}
		<form
			bind:this={switchForm}
			method="POST"
			action="/admin/ai/settings?/save"
			use:enhance
			class="mt-3 flex flex-col items-center gap-3"
			data-testid="ai-off-switch"
		>
			<input type="hidden" name="enabled" value="true" />
			<Toggle id="ai-off-toggle" label="AI for this tenant" checked={false} onchange={() => switchForm?.requestSubmit()} />
			<Button variant="secondary" type="submit">Turn AI on</Button>
		</form>
	</EmptyState>
{:else if effective.state === 'no_provider'}
	<EmptyState
		title="AI has nothing to answer through"
		description="The plugin answered 503: no enabled provider is configured, or its store did not answer. Add or enable a provider, then try again."
	>
		{#snippet iconSnippet()}
			<Server size={ICON.lg} />
		{/snippet}
		{#snippet action()}
			<Button variant="secondary" href="/admin/ai/providers">Open providers</Button>
		{/snippet}
	</EmptyState>
{:else if effective.state === 'error'}
	<Alert tone="danger" title="Could not read {noun}">{effective.message}</Alert>
{/if}
