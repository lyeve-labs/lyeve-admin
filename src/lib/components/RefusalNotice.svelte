<script lang="ts">
	/**
	 * A write the engine refused for the license, said the same way on every
	 * page: the count against the ceiling for a cap, the capability's name for
	 * a feature, and a link to where the license is read and changed. Every
	 * number comes from the refusal, so a lifted ceiling never reads as a
	 * stale one here.
	 */
	import { Alert, Button } from '@lyeve-labs/ui-kit';
	import { useInstance } from '$lib/instance.svelte';
	import { isExternalHref } from '$lib/links';
	import { LICENSE_PAGE, refusalText, refusalTitle, type Refusal } from '$lib/api/refusal';

	let { refusal }: { refusal: Refusal } = $props();

	const instance = useInstance();
	// The license page is always offered. A link the engine or the license
	// module names goes beside it, because that is where the license changes.
	const upgrade = $derived(instance.upgradeLink(refusal.upgradeUrl || null));
	const away = $derived(upgrade !== null && isExternalHref(upgrade.href));
</script>

<div data-testid="refusal-notice">
	<Alert tone="warn" title={refusalTitle(refusal)}>
		<p>{refusalText(refusal)}</p>
		<div class="mt-3 flex flex-wrap gap-2">
			<Button variant="secondary" size="sm" href={LICENSE_PAGE}>View the license</Button>
			{#if upgrade && upgrade.href !== LICENSE_PAGE}
				<Button
					variant="ghost"
					size="sm"
					href={upgrade.href}
					target={away ? '_blank' : undefined}
					rel={away ? 'noopener noreferrer' : undefined}
				>
					{upgrade.label ?? 'How to enable it'}
				</Button>
			{/if}
		</div>
	</Alert>
</div>
