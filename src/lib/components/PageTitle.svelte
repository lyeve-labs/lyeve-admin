<script lang="ts">
	import { page } from '$app/state';
	import { documentTitle, pageBrand } from '$lib/brand';

	interface Props {
		/** The page's own part of the tab title. Empty leaves the name alone. */
		title?: string;
	}

	let { title = '' }: Props = $props();

	// The nearest layout's brand: the session tenant's inside the admin, the
	// public one outside it. A test that mocks the page state may leave the
	// data out, which reads as the stock name.
	const text = $derived(documentTitle(pageBrand(page.data), title));
</script>

<svelte:head>
	<title>{text}</title>
</svelte:head>
