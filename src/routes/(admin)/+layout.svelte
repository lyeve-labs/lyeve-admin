<script lang="ts">
	import { page } from '$app/state';
	import {
		AccountMenu,
		AppShell,
		Banner,
		Button,
		DialogContainer,
		Logo,
		PageShell,
		SidebarNav,
		ThemeToggle,
		Toaster,
	} from '@lyeve-labs/ui-kit';
	import { BookOpen, LifeBuoy, LogOut, MonitorSmartphone, Settings, ShieldCheck } from '@lucide/svelte';
	import DbStatus from '$lib/components/DbStatus.svelte';
	import RouteProgress from '$lib/components/RouteProgress.svelte';
	import NotRunning from '$lib/components/NotRunning.svelte';
	import { appName, brandOf } from '$lib/brand';
	import { adminNav, adminSection, customizeNav, pageLabel, pagePlugin } from '$lib/nav';
	import { accentStyle } from '$lib/api/customization';
	import { provideShell } from '$lib/shell.svelte';
	import { provideInstance } from '$lib/instance.svelte';
	import { hasLicenseModule } from '$lib/entitlements';
	import { PLUGIN } from '$lib/plugin-names';
	import { notRunning, runs, whyNotRunning, UNNAMED } from '$lib/plugins';
	import type { LayoutData } from './$types';
	import type { Snippet } from 'svelte';
	import { ICON } from '$lib/icon';

	let { data, children }: { data: LayoutData; children: Snippet } = $props();

	// Which plugins run for this tenant. A load that sent no set, which only a
	// test does, reads as an engine that does not name them.
	const plugins = $derived(data.plugins ?? UNNAMED);
	const operator = $derived(data.user.roles.includes('admin') || data.user.roles.includes('super_admin'));

	// The tree is data in $lib/nav.ts, so the grouping and the role gate can be
	// asserted without rendering the shell.
	// The running plugins decide which entries exist at all: a plugin that does
	// not run for this tenant has no menu row rather than a row that leads to a
	// page with nothing behind it.
	const custom = $derived(data.customization?.entitled ? data.customization : null);
	const navItems = $derived(
		customizeNav(
			adminNav(data.user.roles, {
				plugins,
				customizable: data.customization?.entitled,
				licenseModule: hasLicenseModule(data.entitlements),
			}),
			custom ? { ...custom.settings.menu, pages: custom.pages } : null,
			data.user.roles,
		),
	);
	// One brand for the frame, the titles and the icon. A load that sent
	// none, which only a test does, reads the customization itself.
	const brand = $derived(data.brand ?? brandOf(custom?.settings.brand));
	const brandName = $derived(brand.name);
	const brandLogo = $derived(brand.logo_url);
	// The tenant's accent repaints the brand ramp for everything inside the
	// shell, one ramp per theme so the color stays readable on both.
	const tenantAccent = $derived(brand.accent ? accentStyle(brand.accent) : '');

	// One gate for every plugin's page, reached by its URL while its plugin
	// does not run. The page's own reads would answer 404 or 403, and a page
	// that treats a refused read as an empty one would show an empty library
	// with an upload button that fails, so the shell says why in its place.
	const gated = $derived.by(() => {
		const plugin = pagePlugin(page.url.pathname);
		if (plugin === undefined || !notRunning(plugins, plugin)) return undefined;
		return {
			plugin,
			title: pageLabel(page.url.pathname) ?? plugin,
			reason: whyNotRunning(plugin, plugins, data.pluginStatus),
		};
	});
	const section = $derived(adminSection(page.url.pathname, navItems, appName(brand)));

	// The two personal pages each belong to a plugin, so each row shows only
	// while its plugin runs rather than leading to a page with nothing behind it.
	const twoFactor = $derived(runs(plugins, PLUGIN.mfa));
	const remembersDevices = $derived(runs(plugins, PLUGIN.deviceFingerprint));

	// Where a header form sends the reader back to. The query is part of it: a
	// list returned to without its filters and its offset is not the screen the
	// reader left.
	const here = $derived(page.url.pathname + page.url.search);

	let navOpen = $state(false);

	// What the page under the shell asks of it. The flow editor's focus mode
	// puts the sidebar and the header away while it is open, and a page has
	// no other line to the layout: it cannot see AppShell and the layout's
	// load knows nothing of a toggle the page keeps in the browser.
	const shell = provideShell();

	// What the instance serves and where the license module sends an operator,
	// for any component under the shell that has to say so. The support link
	// is the module's, so a build without one offers none.
	const instance = provideInstance(() => ({ entitlements: data.entitlements, plugins, licensing: data.licensing }));
	const support = $derived(instance.supportLink());

	// The sidebar is 240px the schema canvas and the content tables would
	// rather have. Remembered per browser: a reader who puts it away wants it
	// away on the next page too, and the server cannot know either way, so the
	// first paint is always the expanded one.
	const COLLAPSE_KEY = 'lyeve-admin-sidebar-collapsed';
	let sidebarCollapsed = $state(false);
	let restored = false;

	$effect(() => {
		// Read first and unconditionally: an effect that only writes the state
		// on its first pass never depends on it, so it never runs again and the
		// toggle stops being remembered.
		const collapsed = sidebarCollapsed;
		if (!restored) {
			restored = true;
			try {
				sidebarCollapsed = localStorage.getItem(COLLAPSE_KEY) === '1';
			} catch {
				// A browser refusing storage is not a reason to lose the sidebar.
			}
			return;
		}
		try {
			localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
		} catch {
			// Same: the toggle still works, it just does not survive a reload.
		}
	});

	// A separate origin from the instance being administered, like the
	// support link.
	const DOCS_URL = 'https://docs.lyeve.com/';
</script>

<!-- Focus mode narrows the sidebar to the kit's icon rail and puts the header
     away. It never touches the reader's own collapse choice, so leaving focus
     mode brings back whatever the reader had. The rail keeps every section
     one hover or one Tab away, where a hidden sidebar would leave only the
     browser. -->
<RouteProgress />

<div class="contents" class:tenant-accent={!!tenantAccent} style={tenantAccent || undefined}>
<AppShell
	{section}
	bind:navOpen
	collapsible
	bind:collapsed={sidebarCollapsed}
	rail={shell.focus}
	headerHidden={shell.focus}
	sidebarLabel="Admin sidebar"
>
	{#snippet brand({ rail })}
		<!-- The rail is 56px and its row has the inline gutter: the 28px mark fits
		     with no padding of its own, and with the wide row's 8px it clips. -->
		<!-- The mark alone is aria-hidden, so on the rail the link would have no
		     name. One fixed name, rather than one per state, keeps it from changing
		     under a reader as the rail opens on focus. -->
		<a
			href="/"
			aria-label="{brandName || 'LyEve'} home"
			class="relative hit-area inline-flex items-center gap-2 rounded-lg py-1 {rail ? '' : 'px-2'}"
		>
			{#if brandLogo}
				<!-- The tenant's own mark. A fixed box keeps a tall or wide logo from
				     pushing the rail's row. Alt is empty because the link is named. -->
				<img src={brandLogo} alt="" class="size-7 shrink-0 rounded object-contain" />
				{#if !rail && brandName}
					<span class="truncate text-sm font-semibold text-fg">{brandName}</span>
				{/if}
			{:else if brandName && !rail}
				<Logo wordmark={false} />
				<span class="truncate text-sm font-semibold text-fg">{brandName}</span>
			{:else}
				<Logo wordmark={!rail} />
			{/if}
		</a>
	{/snippet}

	{#snippet nav({ rail })}
		<!-- min-h-0 so the nav's own overflow-y-auto has something to scroll
		     against: without it the sections past the fold are unreachable. -->
		<SidebarNav
			items={navItems}
			activePath={page.url.pathname}
			label="Admin sections"
			storageKey="lyeve-admin-nav"
			collapsed={rail}
			class="min-h-0 w-full flex-1 px-inline"
		/>
	{/snippet}

	{#snippet headerActions()}
		<!-- Absent for a session that cannot apply a migration: the engine refuses
		     the write to anyone but an admin, so the control is not offered. -->
		{#if data.migrations}
			<DbStatus pending={data.migrations.pending} redirectTo={here} />
		{/if}
		<ThemeToggle />
		<AccountMenu name={data.user.email} secondary={data.user.roles.join(', ')}>
			<Button href="/admin/settings/account" variant="secondary" size="sm" full>
				<Settings size={ICON.sm} />
				Account and appearance
			</Button>
			<!-- The two surfaces that are the signed-in person's own rather than
			     the instance's. Neither has a sidebar row, because the sidebar
			     groups by role and these belong to everybody. Listed here, neither
			     needs its URL typed to be reached. -->
			{#if twoFactor}
				<Button href="/admin/settings/mfa" variant="secondary" size="sm" full>
					<ShieldCheck size={ICON.sm} />
					Two-factor authentication
				</Button>
			{/if}
			{#if remembersDevices}
				<Button href="/admin/settings/devices" variant="secondary" size="sm" full>
					<MonitorSmartphone size={ICON.sm} />
					Trusted devices
				</Button>
			{/if}
			<!-- Another origin, so it opens in its own tab and cannot reach back
			     through window.opener into the admin session. -->
			<Button
				href={DOCS_URL}
				variant="secondary"
				size="sm"
				full
				target="_blank"
				rel="noreferrer noopener"
			>
				<BookOpen size={ICON.sm} />
				Documentation
			</Button>
			{#if support}
				<Button
					href={support.href}
					variant="secondary"
					size="sm"
					full
					target="_blank"
					rel="noreferrer noopener"
				>
					<LifeBuoy size={ICON.sm} />
					{support.label ?? 'Support'}
				</Button>
			{/if}
			<!-- A real post, so signing out survives a page that never hydrated. -->
			<form method="POST" action="/logout">
				<Button type="submit" variant="danger" size="sm" full>
					<LogOut size={ICON.sm} />
					Sign out
				</Button>
			</form>
		</AccountMenu>
	{/snippet}

	{#if plugins.state === 'unread'}
		<!-- A failed read is not an empty install. The engine's own pages stay,
		     and this says why the plugin pages are missing. -->
		<Banner tone="warn">
			The engine did not say which plugins run, so the sidebar lists only its own pages. Reload the page to ask again.
		</Banner>
	{/if}
	{#if gated}
		<PageShell title={gated.title} width="wide">
			<NotRunning title={gated.title} plugin={gated.plugin} reason={gated.reason} {operator} />
		</PageShell>
	{:else}
		{@render children()}
	{/if}
</AppShell>
</div>

<Toaster />
<!-- The kit's confirm() and every dialog it stacks render through this. Without
     it the calls resolve to nothing and the reader sees no dialog at all. -->
<DialogContainer />
