<script lang="ts">
	/**
	 * What the shell shows in place of a page whose plugin does not run.
	 *
	 * Every reader is told the page is unavailable, and that it was withheld
	 * from this tenant when it was. An operator reads the plugin status, so an
	 * operator is also told why: the plugin failed to start, is not enabled on
	 * this instance, was not started, or is not part of this build.
	 */
	import { Button, EmptyState } from '@lyeve-labs/ui-kit';
	import { Ban, CircleSlash, OctagonAlert, PackageX, PowerOff } from '@lucide/svelte';
	import NotEnabled from '$lib/components/NotEnabled.svelte';
	import { ICON } from '$lib/icon';
	import type { NotRunningReason } from '$lib/plugins';

	let {
		title,
		plugin,
		reason,
		operator = false,
	}: {
		/** The page's name. */
		title: string;
		/** The plugin the page belongs to. */
		plugin: string;
		reason: NotRunningReason;
		/** Whether the reader may open the plugin list, where the details are. */
		operator?: boolean;
	} = $props();

	const details = $derived(`/admin/plugins/${encodeURIComponent(plugin)}`);
</script>

{#snippet detailsLink()}
	<Button variant="secondary" href={details}>Plugin details</Button>
{/snippet}

<!-- Tests find every case by the test id, and tell them apart by the state. -->
<div data-testid="not-running" data-state={reason.state} data-plugin={plugin}>
	{#if reason.state === 'withheld'}
		<EmptyState
			title="Withheld from this tenant"
			description="An administrator of this instance withheld {title} from this tenant. Ask them to make it available again."
		>
			{#snippet iconSnippet()}<Ban size={ICON.lg} />{/snippet}
		</EmptyState>
	{:else if reason.state === 'not-enabled'}
		<NotEnabled {title} url={reason.upgradeUrl} />
	{:else if reason.state === 'failed'}
		<EmptyState
			title="Failed to start"
			description="The {plugin} plugin stopped with an error when the engine started it."
			action={detailsLink}
		>
			{#snippet iconSnippet()}<OctagonAlert size={ICON.lg} />{/snippet}
			{#if reason.error}
				<code class="break-words font-mono text-xs text-fg">{reason.error}</code>
			{/if}
		</EmptyState>
	{:else if reason.state === 'not-started'}
		<EmptyState
			title="Not started"
			description="The {plugin} plugin is part of this build, and the engine did not start it."
			action={detailsLink}
		>
			{#snippet iconSnippet()}<PowerOff size={ICON.lg} />{/snippet}
			{#if reason.reason}
				<p>The engine says: {reason.reason}.</p>
			{/if}
		</EmptyState>
	{:else if reason.state === 'not-built'}
		<EmptyState
			title="Not part of this build"
			description="This engine was built without the {plugin} plugin, so there is nothing to show here."
		>
			{#snippet iconSnippet()}<PackageX size={ICON.lg} />{/snippet}
		</EmptyState>
	{:else}
		<EmptyState
			title="Not running"
			description={operator
				? 'The plugin behind this page is not running, and the engine did not say why.'
				: 'The plugin behind this page is not running on this instance. An administrator of this instance can say why.'}
			action={operator ? detailsLink : undefined}
		>
			{#snippet iconSnippet()}<CircleSlash size={ICON.lg} />{/snippet}
		</EmptyState>
	{/if}
</div>
