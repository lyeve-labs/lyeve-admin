<script lang="ts">
	import '../app.css';
	import { getThemePreference, setThemePreference, watchSystemTheme } from '@lyeve-labs/ui-kit';
	import type { Snippet } from 'svelte';
	import { page } from '$app/state';
	import { asset } from '$app/paths';
	import { pageBrand } from '$lib/brand';

	let { children }: { children: Snippet } = $props();

	// The nearest layout's brand decides the tab icon: the session tenant's
	// inside the admin, the public one outside it. Without one the product's
	// icons stand.
	const favicon = $derived(pageBrand(page.data)?.favicon_url || '');

	// A reader who asked to follow the desktop gets the new palette when the
	// desktop flips at dusk. The kit's toggle watches for that while it is
	// mounted, and it is mounted only inside the authed frame: sign-in, first-run
	// setup and the error pages sit outside that frame and would otherwise hold
	// whatever palette they booted with for the life of the tab.
	//
	// The first paint needs nothing here. The pre-paint script in app.html has
	// already put the resolved palette on the document element, and re-applying
	// it on mount would persist `system` as a choice for a reader who has not
	// made one yet.
	$effect(() =>
		watchSystemTheme(() => {
			if (getThemePreference() === 'system') setThemePreference('system');
		}),
	);
</script>

<svelte:head>
	{#if favicon}
		<link rel="icon" href={favicon} />
	{:else}
		<link rel="icon" href={asset('/favicon.ico')} sizes="32x32" />
		<link rel="icon" href={asset('/favicon.svg')} type="image/svg+xml" />
	{/if}
</svelte:head>

{@render children()}
