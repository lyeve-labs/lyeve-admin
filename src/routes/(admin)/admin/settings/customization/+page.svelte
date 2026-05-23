<script lang="ts">
	import PageTitle from '$lib/components/PageTitle.svelte';
	import {
		Alert,
		Badge,
		Button,
		Card,
		CheckboxGroup,
		Drawer,
		EmptyState,
		Input,
		PageShell,
		SectionHeading,
		Select,
		Table,
		Textarea,
		confirm as confirmDialog,
	} from '@lyeve-labs/ui-kit';
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { ExternalLink, LayoutDashboard, Pencil, Plus, Trash2 } from '@lucide/svelte';
	import { ICON } from '$lib/icon';
	import NotEnabled from '$lib/components/NotEnabled.svelte';
	import BrandImageCard, { type ImageNotice } from './BrandImageCard.svelte';
	import { accentShades, parseAccent, slugify, ROLE_CHOICES } from '$lib/api/customization';
	import { formatDateTime } from '$lib/format';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const roleOptions = ROLE_CHOICES.map((r) => ({ value: r, label: r }));
	const fields = $derived((form as { fields?: Record<string, string> } | null)?.fields ?? {});

	let name = $state('');
	let accent = $state('');
	let welcome = $state('');
	let hidden = $state<string[]>([]);
	let pinned = $state<string[]>([]);
	let homePage = $state('');
	$effect.pre(() => {
		name = data.settings.brand.name;
		accent = data.settings.brand.accent;
		welcome = data.settings.brand.welcome;
		hidden = [...data.settings.menu.hidden];
		pinned = [...data.settings.menu.pinned];
		homePage = data.settings.home_page;
	});
	const accentOk = $derived(parseAccent(accent));
	const preview = $derived(
		accentOk ? { light: accentShades(accentOk, 'light'), dark: accentShades(accentOk, 'dark') } : null,
	);
	const accentNote = $derived.by(() => {
		if (!preview) return '';
		const notes: string[] = [];
		if (preview.light.adjusted) notes.push(`darkened to ${preview.light.base} on the light theme`);
		if (preview.dark.adjusted) notes.push(`lightened to ${preview.dark.base} on the dark theme`);
		return notes.length ? `Hard to read as chosen, so it is ${notes.join(' and ')}.` : '';
	});

	const navOptions = $derived(
		data.navChoices.map((c) => ({ value: c.id, label: c.section ? `${c.section}: ${c.label}` : c.label })),
	);
	const pinOptions = $derived(navOptions.filter((o) => !hidden.includes(o.value)));
	const homeOptions = $derived([
		{ value: '', label: 'None' },
		...data.pages.map((p) => ({ value: p.slug, label: p.title })),
	]);

	/** What the last image submit said, for the card it was about. */
	function imageState(kind: 'logo' | 'favicon') {
		const f = (form ?? {}) as Record<string, unknown>;
		const notice: ImageNotice = f[`${kind}Imported`]
			? 'imported'
			: f[`${kind}Uploaded`]
				? 'uploaded'
				: f[`${kind}Saved`]
					? 'saved'
					: f[`${kind}Removed`]
						? 'removed'
						: '';
		return {
			error: typeof f[`${kind}Error`] === 'string' ? (f[`${kind}Error`] as string) : '',
			fieldError: fields[`${kind}_url`],
			notice,
		};
	}
	const logoState = $derived(imageState('logo'));
	const faviconState = $derived(imageState('favicon'));

	// Drawers
	let linkOpen = $state(false);
	let linkRoles = $state<string[]>([]);
	let pageOpen = $state(false);
	let pageTitle = $state('');
	let pageSlug = $state('');
	let slugTouched = $state(false);
	let pageRoles = $state<string[]>([]);
	const suggestedSlug = $derived(slugTouched ? pageSlug : slugify(pageTitle));

	const keep: SubmitFunction = () => async ({ update }) => update({ reset: false });

	const closeOnSuccess = (close: () => void): SubmitFunction => () => async ({ result, update }) => {
		if (result.type === 'success') close();
		await update({ reset: false });
	};

	function confirmRemove(what: string, detail: string): SubmitFunction {
		return async ({ cancel }) => {
			const ok = await confirmDialog(`Delete ${what}?`, detail, { confirmLabel: 'Delete' });
			if (!ok) cancel();
		};
	}
</script>

<PageTitle title="Customization" />

<PageShell
	title="Customization"
	description="How this tenant's admin looks and what it offers: its name, logo, tab icon and colors, its dashboard, its menu, and pages of its own."
	width="wide"
>
	{#snippet actions()}
		<Badge tone="violet" size="sm">Beta</Badge>
	{/snippet}

	{#if !data.entitled}
		<NotEnabled
			title="Customization"
			description="Give each tenant its own name, logo and colors, a dashboard and a menu shaped to what its team uses, and pages built for that team."
		/>
	{:else}
		<!-- Every form on this page stacks the same way: label, control, hint,
		     then its buttons on a row of their own. A button beside a field
		     lines up with the control only while neither has a hint, and most
		     here do. -->
		<div class="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
			<Card pad="md">
				{#snippet header()}
					<SectionHeading level={3}>Brand</SectionHeading>
				{/snippet}
				<form method="POST" action="?/brand" class="flex flex-col gap-4" use:enhance={keep}>
					{#if form?.brandError}
						<Alert tone="danger">{form.brandError}</Alert>
					{:else if form && 'brandSaved' in form}
						<Alert tone="success" autoDismiss>Saved. Every page of this tenant's admin now carries it.</Alert>
					{/if}
					<Input id="brand-name" name="name" label="Name" hint="Replaces the product name in the sidebar, on the sign-in pages and in every tab title." bind:value={name} />
					<div class="flex flex-col gap-2">
						<Input
							id="brand-accent"
							name="accent"
							label="Accent color"
							mono
							placeholder="#0a7cff"
							hint={accentNote || 'Written #RRGGBB. Buttons, links and highlights take it, adjusted per theme when needed to stay readable.'}
							error={accent && accentOk === null ? 'Written #RRGGBB' : undefined}
							bind:value={accent}
						/>
						{#if preview}
							<div class="flex flex-wrap gap-6" data-testid="accent-preview">
								{#each [['Dark theme', preview.dark], ['Light theme', preview.light]] as const as [label, ramp] (label)}
									<div class="flex items-center gap-2">
										<div class="flex gap-1" aria-hidden="true">
											<span class="size-6 rounded" style="background: {ramp.light}"></span>
											<span class="size-6 rounded" style="background: {ramp.base}"></span>
											<span class="size-6 rounded" style="background: {ramp.deep}"></span>
										</div>
										<span class="text-xs text-faint">{label}, {ramp.contrast.toFixed(1)}:1</span>
									</div>
								{/each}
							</div>
						{/if}
					</div>
					<Textarea id="brand-welcome" name="welcome" label="Welcome line" rows={2} hint="Shown at the top of the dashboard. At most 280 characters." bind:value={welcome} />
					<div><Button variant="primary" type="submit">Save</Button></div>
				</form>
			</Card>

			<BrandImageCard kind="logo" current={data.settings.brand.logo_url} mediaChoices={data.mediaChoices} {...logoState} />

			<BrandImageCard kind="favicon" current={data.settings.brand.favicon_url ?? ''} mediaChoices={data.mediaChoices} {...faviconState} />

			<Card pad="md">
				{#snippet header()}
					<div class="flex items-center justify-between gap-2">
						<SectionHeading level={3}>Dashboard</SectionHeading>
						<Button variant="secondary" size="sm" href="/admin/settings/customization/dashboard">
							<LayoutDashboard size={ICON.sm} /> Edit dashboard
						</Button>
					</div>
				{/snippet}
				<div class="flex flex-col gap-4">
					<p class="text-sm text-muted" data-testid="dashboard-state">
						{#if data.dashboard?.custom}
							The tenant opens on its own dashboard of {data.dashboard.widgets.length}
							{data.dashboard.widgets.length === 1 ? 'widget' : 'widgets'}{#if data.dashboard.updated_at}, saved {formatDateTime(data.dashboard.updated_at)}{/if}.
						{:else if data.dashboard}
							The tenant opens on the stock dashboard. Compose one from widgets over its content, activity, media and API usage.
						{:else}
							The dashboard layout could not be read.
						{/if}
					</p>
					{#if form?.pagesError}
						<Alert tone="danger">{form.pagesError}</Alert>
					{:else if form && 'homeSaved' in form}
						<Alert tone="success" autoDismiss>The dashboard follows it now.</Alert>
					{/if}
					{#if data.pages.length === 0}
						<p class="text-sm text-muted">A page of this tenant's own can also lead the dashboard. Build one under Pages first.</p>
					{:else}
						<form method="POST" action="?/home" class="flex flex-col gap-4" use:enhance={keep}>
							<input type="hidden" name="home_page" value={homePage} />
							<Select
								id="home-page"
								label="Page above the dashboard"
								hint="Shown at the top of the dashboard, above its panels or widgets."
								options={homeOptions}
								value={homePage}
								onvaluechange={(v) => (homePage = v)}
							/>
							<div><Button variant="secondary" type="submit">Save</Button></div>
						</form>
					{/if}
				</div>
			</Card>

			<Card pad="md">
				{#snippet header()}
					<div class="flex items-center justify-between gap-2">
						<SectionHeading level={3}>Pages</SectionHeading>
						<Button variant="secondary" size="sm" onclick={() => (pageOpen = true)}>
							<Plus size={ICON.sm} /> New page
						</Button>
					</div>
				{/snippet}
				{#if data.pages.length === 0}
					<EmptyState title="No pages yet" description="Build a page for the team from text, callouts, content lists, counts and links. It gets its own entry in the menu." />
				{:else}
					<Table label="Pages">
						<thead>
							<tr>
								<th scope="col">Page</th>
								<th scope="col">Seen by</th>
								<th scope="col" class="text-right">Actions</th>
							</tr>
						</thead>
						<tbody>
							{#each data.pages as p (p.slug)}
								<tr>
									<td>
										<a href="/admin/pages/{p.slug}" class="text-fg transition-colors hover:text-brand">{p.title}</a>
										{#if data.settings.home_page === p.slug}<Badge tone="brand" size="sm">Dashboard</Badge>{/if}
									</td>
									<td class="text-xs text-muted">{p.roles.length ? p.roles.join(', ') : 'Everyone'}</td>
									<td>
										<div class="flex items-center justify-end gap-2">
											<Button variant="ghost" size="sm" href="/admin/settings/customization/pages/{p.slug}" aria-label="Edit {p.title}">
												<Pencil size={ICON.sm} />
											</Button>
											<form method="POST" action="?/deletePage" use:enhance={confirmRemove(p.title, 'Its menu entry goes with it, and the dashboard stops showing it.')}>
												<input type="hidden" name="slug" value={p.slug} />
												<Button variant="ghost" size="sm" type="submit" aria-label="Delete {p.title}">
													<Trash2 size={ICON.sm} class="text-danger" />
												</Button>
											</form>
										</div>
									</td>
								</tr>
							{/each}
						</tbody>
					</Table>
				{/if}
			</Card>
		</div>

		<Card pad="md">
			{#snippet header()}
				<SectionHeading level={3}>Menu</SectionHeading>
			{/snippet}
			<form method="POST" action="?/menu" class="flex flex-col gap-4" use:enhance={keep}>
				{#if form?.menuError}
					<Alert tone="danger">{form.menuError}</Alert>
				{:else if form && 'menuSaved' in form}
					<Alert tone="success" autoDismiss>Saved.</Alert>
				{/if}
				<div class="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
					<CheckboxGroup
						name="hidden"
						label="Hidden"
						hint="Entries this tenant's team never uses. Hiding one takes it off the menu only. The page stays guarded by its own access rules."
						options={navOptions}
						bind:value={hidden}
					/>
					<CheckboxGroup
						name="pinned"
						label="Pinned"
						hint="Entries shown in a group of their own at the top of the menu."
						options={pinOptions}
						bind:value={pinned}
					/>
				</div>
				<div><Button variant="primary" type="submit">Save</Button></div>
			</form>
		</Card>

		<Card pad="md">
			{#snippet header()}
				<div class="flex items-center justify-between gap-2">
					<SectionHeading level={3}>Links</SectionHeading>
					<Button variant="secondary" size="sm" onclick={() => (linkOpen = true)}>
						<Plus size={ICON.sm} /> New link
					</Button>
				</div>
			{/snippet}
			{#if data.settings.menu.links.length === 0}
				<p class="text-sm text-muted">No links yet. A link puts the team's own tools in the menu: a status page, a wiki, a report.</p>
			{:else}
				<ul class="flex flex-col divide-y divide-line">
					{#each data.settings.menu.links as link, i (i)}
						<li class="flex items-center justify-between gap-3 py-2">
							<span class="flex min-w-0 items-center gap-2 text-sm">
								<span class="text-fg">{link.label}</span>
								<span class="truncate font-mono text-xs text-faint">{link.url}</span>
								{#if link.roles?.length}<Badge size="sm">{link.roles.join(', ')}</Badge>{/if}
							</span>
							<span class="flex shrink-0 items-center gap-2">
								{#if !link.url.startsWith('/admin/')}<ExternalLink size={ICON.sm} class="text-faint" aria-hidden="true" />{/if}
								<form method="POST" action="?/removeLink" use:enhance={confirmRemove(link.label, 'It leaves the menu for everyone in this tenant.')}>
									<input type="hidden" name="index" value={i} />
									<Button variant="ghost" size="sm" type="submit" aria-label="Delete {link.label}">
										<Trash2 size={ICON.sm} class="text-danger" />
									</Button>
								</form>
							</span>
						</li>
					{/each}
				</ul>
			{/if}
		</Card>
	{/if}
</PageShell>

<Drawer bind:open={linkOpen} title="New link">
	<form method="POST" action="?/addLink" id="link-form" class="flex flex-col gap-4" use:enhance={closeOnSuccess(() => (linkOpen = false))}>
		{#if form?.linkError && linkOpen}
			<Alert tone="danger">{form.linkError}</Alert>
		{/if}
		<Input id="link-label" name="label" label="Label" required error={fields.label} />
		<Input id="link-url" name="url" label="Address" mono required placeholder="https://" hint="An https URL, or an admin path such as /admin/media." error={fields.url} />
		<CheckboxGroup name="roles" label="Seen by" hint="Leave empty for everyone." options={roleOptions} bind:value={linkRoles} />
	</form>
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (linkOpen = false)}>Cancel</Button>
		<Button variant="primary" type="submit" form="link-form">Create</Button>
	{/snippet}
</Drawer>

<Drawer bind:open={pageOpen} title="New page">
	<form method="POST" action="?/createPage" id="page-form" class="flex flex-col gap-4" use:enhance>
		{#if form?.pageError && pageOpen}
			<Alert tone="danger">{form.pageError}</Alert>
		{/if}
		<Input id="page-title" name="title" label="Title" required bind:value={pageTitle} error={fields.title} />
		<Input
			id="page-slug"
			name="slug"
			label="Address"
			mono
			hint="The page opens at /admin/pages/ followed by this."
			value={suggestedSlug}
			oninput={(e: Event & { currentTarget: HTMLInputElement }) => {
				slugTouched = true;
				pageSlug = e.currentTarget.value;
			}}
			error={fields.slug}
		/>
		<CheckboxGroup name="roles" label="Seen by" hint="Leave empty for everyone in this tenant." options={roleOptions} bind:value={pageRoles} />
	</form>
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (pageOpen = false)}>Cancel</Button>
		<Button variant="primary" type="submit" form="page-form">Create</Button>
	{/snippet}
</Drawer>
