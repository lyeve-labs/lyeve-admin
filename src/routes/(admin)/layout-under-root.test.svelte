<!-- The admin shell under the root layout, so a test reads the tab title the
     root layout's format gives the shell's own PageShell. -->
<script lang="ts">
	import RootLayout from '../+layout.svelte';
	import AdminLayout from './+layout.svelte';
	import EmptyChildren from './layout-empty-children.test.svelte';
	import type { LayoutData } from './$types';

	let { data }: { data: LayoutData } = $props();
</script>

<RootLayout>
	<AdminLayout {data}>
		<EmptyChildren />
	</AdminLayout>
</RootLayout>
