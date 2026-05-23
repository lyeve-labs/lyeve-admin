<script lang="ts">
	/**
	 * What a plugin's page shows in place of what a refused read would have
	 * filled, the same way for every plugin. The page names the feature and
	 * says in its own words what a missing route means for it.
	 */
	import { Alert } from '@lyeve-labs/ui-kit';
	import NotEnabled from '$lib/components/NotEnabled.svelte';
	import { fullText, type Gate } from '$lib/api/gate';

	let {
		gate,
		title,
		absent,
	}: {
		gate: Gate;
		/** The feature's name. */
		title: string;
		/** What the page says when the route is not there. */
		absent: string;
	} = $props();
</script>

{#if gate.state === 'absent'}
	<Alert tone="brand">{absent}</Alert>
{:else if gate.state === 'locked'}
	<NotEnabled {title} url={gate.upgradeUrl} />
{:else if gate.state === 'full'}
	<Alert tone="warn" title="{title} is at its limit">{fullText(gate)}</Alert>
{:else if gate.state === 'error'}
	<Alert tone="danger">{gate.message}</Alert>
{/if}
