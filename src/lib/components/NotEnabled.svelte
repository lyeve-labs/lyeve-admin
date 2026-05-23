<script lang="ts">
	/**
	 * What a page shows for a feature this instance does not serve.
	 *
	 * The heading names the feature and the line under it says the feature is
	 * not enabled on this instance, whatever the reason. A link appears only
	 * when something says where the feature is turned on: the engine, beside
	 * the refusal, or the license module.
	 */
	import { Badge, Button, EmptyState } from '@lyeve-labs/ui-kit';
	import { Lock } from '@lucide/svelte';
	import { ICON } from '$lib/icon';
	import { useInstance } from '$lib/instance.svelte';
	import { isExternalHref } from '$lib/links';

	let {
		title,
		description = '',
		url = undefined,
		compact = false,
		class: cls = '',
	}: {
		/** The feature's name. */
		title: string;
		/** What the feature does, in a sentence or two. */
		description?: string;
		/** The link the engine sent with the refusal or the plugin's status, when it sent one. */
		url?: string | null;
		/** A small marker for a header or a toolbar, in place of the card. */
		compact?: boolean;
		class?: string;
	} = $props();

	const STATE = 'Not enabled on this instance';

	const instance = useInstance();
	const target = $derived(instance.upgradeLink(url));
	// Another origin opens in a tab of its own, so it cannot reach back into
	// the admin session through window.opener.
	const away = $derived(target !== null && isExternalHref(target.href));
</script>

{#snippet lock()}
	<Lock size={ICON.lg} />
{/snippet}

{#snippet detail()}
	<p>{description}</p>
{/snippet}

{#snippet enable()}
	{#if target}
		<Button
			variant="secondary"
			href={target.href}
			target={away ? '_blank' : undefined}
			rel={away ? 'noopener noreferrer' : undefined}
		>
			{target.label ?? 'How to enable it'}
		</Button>
	{/if}
{/snippet}

{#snippet marker()}
	<Badge tone="neutral"><Lock size={ICON.xs} aria-hidden="true" /> {STATE}</Badge>
{/snippet}

<!-- Tests find every form by the test id, which nothing else carries. -->
{#if compact}
	{#if target}
		<a
			data-testid="not-enabled"
			href={target.href}
			target={away ? '_blank' : undefined}
			rel={away ? 'noopener noreferrer' : undefined}
			title={description || title}
			class="inline-flex rounded-full {cls}"
		>
			{@render marker()}
		</a>
	{:else}
		<span data-testid="not-enabled" title={description || title} class="inline-flex {cls}">
			{@render marker()}
		</span>
	{/if}
{:else}
	<div data-testid="not-enabled" class={cls}>
		<EmptyState
			{title}
			description="{STATE}."
			iconSnippet={lock}
			children={description ? detail : undefined}
			action={target ? enable : undefined}
		/>
	</div>
{/if}
