<script lang="ts">
	import PageTitle from '$lib/components/PageTitle.svelte';
	import { PageShell, SectionHeading } from '@lyeve-labs/ui-kit';
	import { ChevronRight } from '@lucide/svelte';
	import { ICON } from '$lib/icon';
	import { adminNav } from '$lib/nav';
	import { hasLicenseModule } from '$lib/entitlements';
	import { PLUGIN } from '$lib/plugin-names';
	import { runs } from '$lib/plugins';
	import { settingsHub } from '$lib/settings-hub';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// Built here rather than in a load: the entries carry their sidebar icons,
	// which are components and cannot cross from the server as data.
	const groups = $derived(
		settingsHub(
			adminNav(data.user.roles, {
				plugins: data.plugins,
				customizable: data.customization?.entitled,
				licenseModule: hasLicenseModule(data.entitlements),
			}),
			{
				twoFactor: runs(data.plugins, PLUGIN.mfa),
				trustedDevices: runs(data.plugins, PLUGIN.deviceFingerprint),
			},
		),
	);
</script>

<PageTitle title="Settings" />

<PageShell
	title="Settings"
	description="Every settings page, grouped by what you came to change. What you see follows your role and what this instance runs."
	width="wide"
>
	{#each groups as group (group.id)}
		<section class="flex flex-col gap-3" aria-label={group.label}>
			<div class="flex flex-col gap-1">
				<SectionHeading level={2}>{group.label}</SectionHeading>
				<p class="text-sm text-muted">{group.description}</p>
			</div>
			<ul class="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
				{#each group.entries as entry (entry.id)}
					<li>
						<a
							href={entry.href}
							class="flex h-full items-start gap-3 rounded-xl border border-line-strong bg-surface p-4 outline-none transition-colors hover:border-brand focus-visible:ring-2 focus-visible:ring-brand"
						>
							{#if entry.icon}
								<entry.icon size={ICON.md} class="mt-0.5 shrink-0 text-muted" />
							{/if}
							<span class="flex min-w-0 flex-1 flex-col gap-1">
								<!-- No beta badge. The page's own header carries its mark,
								     and a mark here would single out some entries among
								     others that are equally beta. -->
								<span class="text-sm font-medium text-fg">{entry.label}</span>
								<span class="text-xs text-muted">{entry.description}</span>
							</span>
							<ChevronRight size={ICON.md} class="mt-0.5 shrink-0 text-faint" aria-hidden="true" />
						</a>
					</li>
				{/each}
			</ul>
		</section>
	{/each}
</PageShell>
