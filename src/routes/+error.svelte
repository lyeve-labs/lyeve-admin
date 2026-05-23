<script lang="ts">
	import PageTitle from '$lib/components/PageTitle.svelte';
	import { page } from '$app/state';
	import ErrorPanel from '$lib/components/ErrorPanel.svelte';

	const status = $derived(page.status);
	const message = $derived(page.error?.message ?? '');
</script>

<PageTitle title={status === 404 ? 'Not found' : status === 401 || status === 403 ? 'No access' : 'Something went wrong'} />

<!-- Outside the console's frame, so this one does own the viewport and centers
     itself in it. -->
<div class="flex min-h-screen items-center justify-center px-page-x py-page-y">
	<ErrorPanel {status} {message} homeHref="/" homeLabel="Home" />
</div>
