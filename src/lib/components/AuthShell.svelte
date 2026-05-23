<script lang="ts">
	import { Card, Logo } from '@lyeve-labs/ui-kit';
	import type { Snippet } from 'svelte';
	import { page } from '$app/state';
	import { accentStyle } from '$lib/api/customization';
	import { pageBrand } from '$lib/brand';

	interface Props {
		/** The one heading on the page. Sign-in swaps it for the second factor step. */
		title: string;
		description?: string;
		children: Snippet;
	}

	let { title, description = undefined, children }: Props = $props();

	// The tenant's brand, read by the root layout without a session, so a
	// reader signs in to the admin they recognize. Unset parts fall back to the
	// product's own.
	const brand = $derived(pageBrand(page.data));
	const accent = $derived(brand?.accent ? accentStyle(brand.accent) : '');
</script>

<!--
	The two signed-out pages are the only surfaces the admin shell does not wrap,
	so PageShell is the wrong frame for them: they carry the product name, not a
	page title, and there is no navigation to sit beside. This is that frame,
	stated once.
-->
<main class="min-h-screen bg-ink flex items-center justify-center px-4 py-10" class:tenant-accent={!!accent} style={accent || undefined}>
	<div class="w-full max-w-md">
		<div class="mb-8 text-center">
			<!-- The same lockup as the product's: a 36px mark and the name beside
			     it. A tenant logo keeps its own proportions inside that height. -->
			{#if brand?.logo_url}
				<span class="mb-5 inline-flex items-center gap-2" data-testid="tenant-brand">
					<img src={brand.logo_url} alt={brand.name ? '' : 'Logo'} class="h-9 max-w-48 object-contain" />
					{#if brand.name}
						<span class="text-xl font-semibold text-fg">{brand.name}</span>
					{/if}
				</span>
			{:else if brand?.name}
				<span class="mb-5 inline-flex items-center gap-2" data-testid="tenant-brand">
					<Logo size="lg" wordmark={false} />
					<span class="text-xl font-semibold text-fg">{brand.name}</span>
				</span>
			{:else}
				<Logo size="lg" class="mb-5" />
			{/if}
			<h1 class="text-2xl font-bold text-fg">{title}</h1>
			{#if description}
				<p class="mt-2 text-muted">{description}</p>
			{/if}
		</div>

		<Card pad="lg">
			{@render children()}
		</Card>
	</div>
</main>
