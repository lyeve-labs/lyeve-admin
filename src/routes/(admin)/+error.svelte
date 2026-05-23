<script lang="ts">
	import PageTitle from '$lib/components/PageTitle.svelte';
	import { page } from '$app/state';
	import { PageShell } from '@lyeve-labs/ui-kit';
	import ErrorPanel from '$lib/components/ErrorPanel.svelte';

	// SvelteKit passes no props to +error.svelte. The status and the error body
	// are only reachable through the page state.
	const status = $derived(page.status);
	const message = $derived(page.error?.message ?? '');
</script>

<PageTitle title={status === 404 ? 'Not found' : status === 401 || status === 403 ? 'No access' : 'Something went wrong'} />

<!-- Inside the console's frame, so it takes the page gutter and rhythm every
     other screen takes rather than centering itself in a viewport it does not
     own. -->
<PageShell title="This page could not be opened" titleHidden width="wide">
	<ErrorPanel {status} {message} homeHref="/admin" homeLabel="Dashboard" />
</PageShell>
