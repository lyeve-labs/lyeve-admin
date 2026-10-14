<!-- A page under the root layout, so a test reads the tab title the layout's
     format gives a PageShell rather than a format of its own. -->
<script lang="ts">
	import { PageShell } from '@lyeve-labs/ui-kit';
	import RootLayout from './+layout.svelte';

	let { title, documentTitle = undefined }: { title: string; documentTitle?: string } = $props();
</script>

<RootLayout>
	<PageShell {title} {documentTitle}>
		<p>Page body</p>
	</PageShell>
</RootLayout>
