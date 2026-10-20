<!-- A page under the root layout, so a test reads the tab title the layout's
     format gives the page's PageShell. -->
<script lang="ts">
	import type { Component } from 'svelte';
	import RootLayout from './+layout.svelte';

	let { page: Page }: { page: Component } = $props();
</script>

<RootLayout>
	<Page />
</RootLayout>
