<script lang="ts">
	/**
	 * What a page shows in place of what a refused read would have filled,
	 * the same way for every page. The page names the feature and says in its
	 * own words what a missing route means for it.
	 */
	import { Alert, Button } from '@lyeve-labs/ui-kit';
	import { RefreshCw } from '@lucide/svelte';
	import { page } from '$app/state';
	import NotEnabled from '$lib/components/NotEnabled.svelte';
	import { ICON } from '$lib/icon';
	import { BUSY, OUTAGE } from '$lib/outage';
	import { forbiddenText, fullText, type Gate } from '$lib/api/gate';

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

	// A plain link to this address works before the page hydrates. After it
	// hydrates, the router keeps the data it holds for an address that did not
	// change, so the link asks for a fresh document instead.
	const here = $derived(`${page.url.pathname}${page.url.search}`);
</script>

{#snippet retry()}
	<div class="mt-3">
		<Button variant="secondary" size="sm" href={here} data-sveltekit-reload>
			<RefreshCw size={ICON.sm} aria-hidden="true" /> {OUTAGE.action}
		</Button>
	</div>
{/snippet}

{#if gate.state === 'absent'}
	<Alert tone="brand">{absent}</Alert>
{:else if gate.state === 'locked'}
	<NotEnabled {title} url={gate.upgradeUrl} />
{:else if gate.state === 'full'}
	<Alert tone="warn" title="{title} is at its limit">{fullText(gate)}</Alert>
{:else if gate.state === 'forbidden'}
	<!-- Trying again cannot change a role, so this one offers nothing to press. -->
	<Alert tone="warn">{forbiddenText(title)}</Alert>
{:else if gate.state === 'busy'}
	<Alert tone="warn" title={BUSY.title}>
		<p>{BUSY.body}</p>
		{@render retry()}
	</Alert>
{:else if gate.state === 'unavailable'}
	<!-- The page around this notice rendered, so unlike the full-page outage it
	     names only the part that could not be read. -->
	<Alert tone="warn" title={OUTAGE.title}>
		<p>The engine or its database did not answer, so {title} could not be read. Nothing was changed. Try again in a moment.</p>
		{@render retry()}
	</Alert>
{:else if gate.state === 'error'}
	<Alert tone="danger">
		<p>{gate.message}</p>
		{@render retry()}
	</Alert>
{/if}
