<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { navigating, page } from '$app/state';
	import type { SubmitFunction } from '@sveltejs/kit';
	import {
		Alert,
		Banner,
		Button,
		Card,
		CheckboxGroup,
		DescriptionList,
		Drawer,
		EmptyState,
		Indicator,
		Input,
		MultiSelect,
		NumberInput,
		PageShell,
		Pagination,
		SectionHeading,
		SegmentedControl,
		Skeleton,
		Table,
		Toggle,
		confirm,
	} from '@lyeve-labs/ui-kit';
	import { Link2, RefreshCw } from '@lucide/svelte';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import NotEnabled from '$lib/components/NotEnabled.svelte';
	import StepUpField from '$lib/components/admin-tokens/StepUpField.svelte';
	import { confirmed, tracked } from '$lib/forms.svelte';
	import { expiresIn, normalizeUserCode, rolesLabel } from '$lib/device-login';
	import { formatDate, formatDateTime, relativeTime } from '$lib/format';
	import { pageHref, pageNumber } from '$lib/api/list';
	import { ICON } from '$lib/icon';
	import {
		SAID,
		lifetimesUpTo,
		personOf,
		shortLabel,
		statusOf,
		type Connection,
		type ConnectionRequest,
		type Settings,
	} from '$lib/api/connected-editors';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const PATH = '/admin/settings/connected-editors';

	/** Whatever the drawer's last submit answered. */
	interface DrawerAnswer {
		code?: string;
		request?: ConnectionRequest | null;
		codeError?: string;
		expired?: boolean;
		decided?: boolean;
		keyChanged?: boolean;
		lifetimeChanged?: boolean;
		stepUp?: { field: string; needsMfa: boolean };
		approvalUnavailable?: boolean;
		checkUnavailable?: boolean;
		withheld?: boolean;
		error?: string;
	}

	/** Every key an action answers with, each optional. */
	interface Answer {
		drawer?: DrawerAnswer;
		approved?: { expires_at: string };
		declined?: boolean;
		revoked?: string;
		revokeError?: string;
		revokedAll?: number;
		revokeAllFailed?: boolean;
		saved?: { field: string; settings: Settings };
		settingError?: { field: string; message: string };
	}

	const answer = $derived((form ?? {}) as Answer);
	const drawer = $derived(answer.drawer ?? null);

	/** The request a lookup found, for as long as it is still the one the code names. */
	type Held = { code: string; request: ConnectionRequest } | null;

	function nextHeld(prev: Held, d: DrawerAnswer | null): Held {
		if (!d) return prev;
		if (d.request && d.code) return { code: d.code, request: d.request };
		if (d.codeError || d.expired || d.decided || d.request === null) return null;
		return prev;
	}

	function initialDrawer(): DrawerAnswer | null {
		return (form as Answer | null)?.drawer ?? null;
	}

	function initiallyOpen(): boolean {
		return data.openApprove || initialDrawer() !== null;
	}

	let open = $state(initiallyOpen());
	let held = $state<Held>(nextHeld(null, initialDrawer()));
	let codeInput = $state(initialDrawer()?.code ?? '');
	let secret = $state('');
	let lifetimePick = $state('');
	let pending = $state<'lookup' | 'approve' | 'decline' | null>(null);
	let lookupForm = $state<HTMLFormElement | null>(null);
	let lastLooked = '';

	// A later answer moves what the drawer holds. The first one was read above,
	// so a page rendered without scripts shows it too.
	$effect(() => {
		const d = drawer;
		untrack(() => {
			held = nextHeld(held, d);
		});
	});

	const request = $derived(held && normalizeUserCode(codeInput) === held.code ? held.request : null);
	const lifetimes = $derived(request ? lifetimesUpTo(request.lifetime_days) : []);
	const lifetime = $derived(
		lifetimes.includes(Number(lifetimePick)) ? lifetimePick : String(request?.lifetime_days ?? ''),
	);
	const mfa = $derived(drawer?.stepUp ? drawer.stepUp.needsMfa : data.mfaEnrolled);

	/** The browser's own word on whether it is online. Approve, Decline and Revoke wait while it is not. */
	let online = $state(true);
	$effect(() => {
		online = navigator.onLine;
		const up = () => (online = true);
		const down = () => (online = false);
		window.addEventListener('online', up);
		window.addEventListener('offline', down);
		return () => {
			window.removeEventListener('online', up);
			window.removeEventListener('offline', down);
		};
	});

	// Focus lands in the code field whenever the drawer opens, the builder's
	// "Open your admin" link included.
	$effect(() => {
		if (!open) return;
		tick().then(() => document.getElementById('connected-editors-code')?.focus());
	});

	const approveReady = $derived(!!request && online && !drawer?.approvalUnavailable);

	/** When a connection approved now with the chosen lifetime would end, never past what the engine said. */
	function expiryOf(r: ConnectionRequest, days: number): string {
		if (days >= r.lifetime_days) return r.would_expire_at;
		const chosen = Date.now() + days * 86_400_000;
		const cap = Date.parse(r.would_expire_at);
		return new Date(Number.isNaN(cap) ? chosen : Math.min(chosen, cap)).toISOString();
	}

	/** The code as typed, read the way the engine reads it, and looked up once the eighth character lands. */
	async function typed() {
		const code = normalizeUserCode(codeInput);
		if (!code) return;
		codeInput = code;
		if (code === held?.code || code === lastLooked || !online) return;
		lastLooked = code;
		await tick();
		lookupForm?.requestSubmit();
	}

	function close() {
		open = false;
		held = null;
		codeInput = '';
		secret = '';
		lastLooked = '';
	}

	const drawerSubmit: SubmitFunction = ({ action }) => {
		const kind = action.search.includes('decline') ? 'decline' : action.search.includes('approve') ? 'approve' : 'lookup';
		pending = kind;
		return async ({ result, update }) => {
			try {
				await update({ reset: false });
				if (kind !== 'lookup' && result.type === 'success') close();
				// A request someone else decided changed the list behind the drawer.
				if (result.type === 'failure' && (result.data as Answer | undefined)?.drawer?.decided) await invalidateAll();
			} finally {
				pending = null;
			}
		};
	};

	const revokeAll = tracked(
		confirmed('Revoke every builder connection on this tenant?', 'Every connected browser stops editing at once.', {
			confirmLabel: 'Revoke all',
			cancelLabel: 'Cancel',
		}),
	);

	function revokeOne(c: Connection): SubmitFunction {
		return confirmed(
			`Revoke ${personOf(c)}'s builder connection?`,
			'That browser stops editing at once.',
			{ confirmLabel: 'Revoke' },
		);
	}

	const anyActive = $derived(
		data.connections.some((c) => c.status === 'approved') || (data.total ?? 0) > data.connections.length,
	);

	const loading = $derived(navigating.to?.url.pathname === PATH);

	// The settings card.
	const settings = $derived(data.settings?.ok ? data.settings.value : null);
	const settingError = $derived(answer.settingError ?? null);
	const savedField = $derived(answer.saved?.field ?? '');

	let allowedOn = $derived(settings?.allowed ?? false);
	let lifetimeSetting = $derived(String(settings?.lifetime_days ?? 90));
	let writes = $derived(settings?.writes_per_minute ?? 120);
	// A schema allowed earlier and deleted since is not offered, so the next save drops it.
	let shown = $derived((settings?.show_schemas ?? []).filter((s) => data.schemas.includes(s)));

	let allowedForm = $state<HTMLFormElement | null>(null);
	const saveAllowed = tracked(() => {});
	const saveLimits = tracked(() => {});

	// The switch applies at once, so it sits in a card of its own. Everything
	// else in the settings saves together under one Save.
	async function allowedChanged(on: boolean) {
		if (!on && settings?.allowed) {
			const ok = await confirm('Turn off the site builder?', 'Every connected browser stops saving at once.', {
				confirmLabel: 'Turn off',
			});
			if (!ok) {
				allowedOn = true;
				return;
			}
		}
		await tick();
		allowedForm?.requestSubmit();
	}

	function errorOn(field: string): string | undefined {
		return settingError?.field === field ? settingError.message : undefined;
	}

	const schemaOptions = $derived(data.schemas.map((s) => ({ value: s, label: s })));

	/** Why Approve cannot be pressed, said beside it. Approval being unavailable has its own alert above. */
	const approveBlocked = $derived(
		!request ? 'Enter the code from the builder to find its request.' : !online ? 'You are offline.' : '',
	);
</script>

{#snippet keyDetail()}
	{#if request}
		<span class="font-mono text-fg">{request.fingerprint}</span>
		<span class="block text-xs text-muted">(check that the builder shows the same key)</span>
	{/if}
{/snippet}

{#snippet fromDetail()}
	{#if request}
		<span class="break-all text-fg">{request.origin || 'No address reported'}</span>
		<span class="block text-xs text-muted">(as the request reports it, unchecked)</span>
	{/if}
{/snippet}

{#snippet nameDetail()}
	{#if request}
		<span dir="auto" title={request.label}>{shortLabel(request.label)}</span>
	{/if}
{/snippet}

<PageShell
	title="Builder connections"
	description="Browsers you allowed to edit pages from the site builder, and a way to revoke them."
	width="wide"
	back={{ href: '/admin/settings', label: 'Settings' }}
>
	{#if !online}
		<Banner tone="warn">You are offline. Approve and Revoke wait until the connection returns.</Banner>
	{/if}

	{#if data.gate.state === 'withheld'}
		<NotEnabled
			level={2}
			title="Builder connections"
			description="An administrator of this engine withheld builder connections from this tenant. Ask them to make builder connections available again."
		/>
	{:else if data.gate.state !== 'ok'}
		<GateNotice level={2} gate={data.gate} title="Builder connections" absent="Builder connections are not available on this engine." />
	{:else}
		{#if answer.approved}
			<Alert tone="success" autoDismiss>Approved. That browser can edit pages now.</Alert>
		{:else if answer.declined}
			<Alert tone="success" autoDismiss>Declined. That browser cannot edit.</Alert>
		{:else if answer.revoked !== undefined}
			<Alert tone="success" autoDismiss>Revoked {answer.revoked}'s connection.</Alert>
		{:else if answer.revokedAll !== undefined}
			<Alert tone="success" autoDismiss>
				Revoked {answer.revokedAll} builder connection{answer.revokedAll === 1 ? '' : 's'}.
			</Alert>
		{:else if answer.revokeError}
			<Alert tone="danger">{answer.revokeError}</Alert>
		{:else if answer.revokeAllFailed}
			<Alert tone="danger" dismissible>
				<p>{SAID.revokeAllFailed}</p>
				<div class="mt-3">
					<Button variant="secondary" size="sm" type="submit" form="revoke-all" disabled={!online}>
						<RefreshCw size={ICON.sm} aria-hidden="true" /> Try again
					</Button>
				</div>
			</Alert>
		{/if}

		<section class="flex flex-col gap-4">
			<div class="flex flex-wrap items-center justify-between gap-3">
				<div class="flex flex-wrap items-center gap-3">
					<Button
						variant="primary"
						href="{PATH}?approve"
						onclick={(e) => {
							e.preventDefault();
							open = true;
						}}
					>
						<Link2 size={ICON.sm} aria-hidden="true" /> Approve a connection
					</Button>
					<span class="text-sm text-muted">Type the code the builder shows you.</span>
				</div>
				{#if data.owner}
					<form id="revoke-all" method="POST" action="?/revokeAll" use:enhance={revokeAll.enhance}>
						<Button variant="danger" type="submit" loading={revokeAll.pending} disabled={!anyActive || !online}>
							Revoke all
						</Button>
					</form>
				{/if}
			</div>

			{#if loading}
				<div class="flex flex-col gap-2" data-testid="connections-loading">
					{#each [1, 2, 3, 4, 5] as row (row)}
						<Skeleton height="2.5rem" />
					{/each}
				</div>
			{:else if data.connections.length === 0}
				<EmptyState
					level={2}
					title="No builder connections yet"
					description="A person connects from the site builder, then approves here with the code it shows."
				>
					{#snippet iconSnippet()}
						<Link2 size={ICON.lg} />
					{/snippet}
				</EmptyState>
			{:else}
				<Table label="Builder connections">
					<thead>
						<tr>
							<th scope="col">Person</th>
							<th scope="col">Key</th>
							<th scope="col">Approved</th>
							<th scope="col">Last used</th>
							<th scope="col">Expires</th>
							<th scope="col">Status</th>
							<th scope="col"><span class="sr-only">Revoke</span></th>
						</tr>
					</thead>
					<tbody>
						{#each data.connections as c (c.id)}
							{@const status = statusOf(c.status)}
							<tr>
								<td data-cell="nowrap">
									<span class="font-medium text-fg">{personOf(c)}</span>
									{#if c.label}
										<div class="text-xs text-faint" dir="auto" title={c.label}>{shortLabel(c.label)}</div>
									{/if}
								</td>
								<td data-cell="nowrap"><span class="font-mono text-xs">{c.fingerprint}</span></td>
								<td data-cell="nowrap" class="text-xs text-faint" title={formatDateTime(c.approved_at)}>
									{formatDate(c.approved_at)}
								</td>
								<td data-cell="nowrap" class="text-xs text-faint" title={formatDateTime(c.last_used_at)}>
									{c.last_used_at ? relativeTime(c.last_used_at) : 'Never'}
								</td>
								<td data-cell="nowrap" class="text-xs text-faint" title={formatDateTime(c.expires_at)}>
									{formatDate(c.expires_at)}
								</td>
								<td data-cell="nowrap">
									<span class="inline-flex items-center gap-2">
										<Indicator tone={status.tone} />
										{status.label}
									</span>
								</td>
								<td data-cell="nowrap">
									{#if c.status === 'approved'}
										<div class="flex justify-end">
											<form method="POST" action="?/revoke" use:enhance={revokeOne(c)}>
												<input type="hidden" name="id" value={c.id} />
												<input type="hidden" name="person" value={personOf(c)} />
												<Button
													variant="ghost"
													size="sm"
													type="submit"
													disabled={!online}
													aria-label="Revoke {personOf(c)}'s connection"
												>
													Revoke
												</Button>
											</form>
										</div>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</Table>
				<Pagination
					page={pageNumber(data.offset, data.limit)}
					perPage={data.limit}
					count={data.connections.length}
					total={data.total ?? undefined}
					hasNext={data.hasMore}
					noun="connections"
					href={pageHref(PATH, data.limit)}
				/>
			{/if}
		</section>

		{#if data.owner && data.settings}
			<section class="flex flex-col gap-4" aria-label="Site builder settings">
				<SectionHeading level={2}>Site builder</SectionHeading>
				{#if !data.settings.ok}
					<GateNotice gate={data.settings.gate} title="Site builder settings" absent="The site builder settings are not available on this engine." />
				{:else if loading}
					<Card>
						<div class="flex flex-col gap-3" data-testid="settings-loading">
							{#each [1, 2, 3, 4] as row (row)}
								<Skeleton height="2rem" />
							{/each}
						</div>
					</Card>
				{:else if settings}
					<Card>
						<form bind:this={allowedForm} method="POST" action="?/setting" use:enhance={saveAllowed.enhance} class="flex flex-col gap-4">
							<input type="hidden" name="field" value="allowed" />
							<input type="hidden" name="allowed" value={allowedOn ? 'on' : 'off'} />
							{#if !settings.allowed}
								<Alert tone="warn">The site builder is off. Connected browsers cannot save.</Alert>
							{/if}
							{#if savedField === 'allowed'}
								<Alert tone="success" autoDismiss>Saved.</Alert>
							{/if}
							<Toggle
								label="Allow the site builder"
								hint="Applies at once. When it is off, connected browsers cannot save."
								bind:checked={allowedOn}
								disabled={saveAllowed.pending || !online}
								onchange={allowedChanged}
							/>
							{#if errorOn('allowed')}
								<Alert tone="danger">{errorOn('allowed')}</Alert>
							{/if}
						</form>
					</Card>

					<Card>
						<form method="POST" action="?/setting" use:enhance={saveLimits.enhance} class="flex flex-col items-start gap-6">
							<input type="hidden" name="field" value="limits" />
							{#if savedField === 'limits'}
								<Alert tone="success" autoDismiss>Saved.</Alert>
							{/if}
							{#if answer.saved?.settings.note}
								<Alert tone="brand">{answer.saved.settings.note}</Alert>
							{/if}

							<SegmentedControl
								label="Valid for"
								name="lifetime_days"
								bind:value={lifetimeSetting}
								options={[
									{ value: '30', label: '30 days' },
									{ value: '90', label: '90 days' },
									{ value: '180', label: '180 days' },
								]}
								hint="For connections approved from now on."
								error={errorOn('lifetime_days')}
							/>

							{#if data.schemasFailed}
								<Alert tone="danger">
									<p>The schemas could not be read, so pages keep showing the ones saved before.</p>
									<div class="mt-3">
										<Button variant="secondary" size="sm" href="{page.url.pathname}{page.url.search}" data-sveltekit-reload>
											<RefreshCw size={ICON.sm} aria-hidden="true" /> Try again
										</Button>
									</div>
								</Alert>
							{:else if data.schemas.length === 0}
								<p class="text-sm text-muted">Create a schema to show its entries on pages.</p>
							{:else}
								<!-- Only a form that offered the schemas saves them, so a schema list that failed to load clears nothing. -->
								<input type="hidden" name="schemas_offered" value="1" />
								{#if data.schemas.length <= 12}
									<CheckboxGroup
										label="Pages may show"
										name="show_schemas"
										bind:value={shown}
										options={schemaOptions}
										orientation="horizontal"
										hint="The schemas whose entries a page may show."
										error={errorOn('show_schemas')}
									/>
								{:else}
									<MultiSelect
										id="show-schemas"
										label="Pages may show"
										bind:value={shown}
										options={schemaOptions}
										searchable
										hint="The schemas whose entries a page may show."
										error={errorOn('show_schemas')}
									/>
									{#each shown as name (name)}
										<input type="hidden" name="show_schemas" value={name} />
									{/each}
								{/if}
							{/if}

							<NumberInput
								id="writes-per-minute"
								name="writes_per_minute"
								label="Writes a minute for each connection"
								bind:value={writes}
								min={1}
								max={settings.max_writes_per_minute}
								hint="Past this, the builder waits a moment and saves again."
								error={errorOn('writes_per_minute')}
							/>

							{#if settingError && !['allowed', 'lifetime_days', 'show_schemas', 'writes_per_minute'].includes(settingError.field)}
								<Alert tone="danger">{settingError.message}</Alert>
							{/if}

							<Button variant="primary" type="submit" loading={saveLimits.pending} disabled={!online}>Save</Button>
						</form>
					</Card>
				{/if}
			</section>
		{/if}
	{/if}
</PageShell>

<Drawer bind:open title="Approve a connection" onclose={close}>
	<div class="flex flex-col gap-4">
		<p class="text-sm text-muted">
			Approve only a code you started yourself in the site builder in the last 10 minutes. Someone who sends you a
			code is asking for access to your pages.
		</p>

		<form
			bind:this={lookupForm}
			method="POST"
			action="?/lookup"
			use:enhance={drawerSubmit}
			class="flex flex-wrap items-end gap-3"
		>
			<div class="min-w-48 flex-1">
				<Input
					id="connected-editors-code"
					name="code"
					label="Code"
					placeholder="K7F3-A2M9"
					autocomplete="off"
					spellcheck={false}
					bind:value={codeInput}
					oninput={typed}
					error={drawer?.codeError}
				/>
			</div>
			<Button variant="secondary" type="submit" loading={pending === 'lookup'}>Find request</Button>
		</form>

		{#if drawer?.withheld}
			<Alert tone="warn">{SAID.withheld}</Alert>
		{/if}
		{#if drawer?.expired}
			<Alert tone="warn">{SAID.expired}</Alert>
		{/if}
		{#if drawer?.decided}
			<Alert tone="warn">{SAID.decided}</Alert>
		{/if}
		{#if drawer?.keyChanged}
			<Alert tone="warn">{SAID.keyChanged}</Alert>
		{/if}
		{#if drawer?.lifetimeChanged}
			<Alert tone="warn">{SAID.lifetime}</Alert>
		{/if}
		{#if drawer?.error}
			<Alert tone="danger">{drawer.error}</Alert>
		{/if}

		{#if request}
			{#if !request.same_network}
				<Alert tone="warn">
					This request came from another network than this browser. Approve only a code you started yourself.
				</Alert>
			{/if}

			<form method="POST" action="?/approve" use:enhance={drawerSubmit} class="flex flex-col gap-4">
				<input type="hidden" name="code" value={held?.code ?? ''} />
				<input type="hidden" name="fingerprint" value={request.fingerprint} />
				<input type="hidden" name="code_expires_at" value={request.code_expires_at} />

				<DescriptionList
					items={[
						{ term: 'Key', value: request.fingerprint, detail: keyDetail },
						{ term: 'From', value: request.origin, detail: fromDetail },
						{ term: 'It may', value: 'read and write pages, sections and the theme, and listed data only with consent' },
						{
							term: 'As',
							value: `${data.email}, with the ${rolesLabel(data.roles)} role${data.roles.length === 1 ? '' : 's'}`,
						},
						...(data.tenant ? [{ term: 'Tenant', value: data.tenant }] : []),
						{ term: 'Expires', value: formatDate(expiryOf(request, Number(lifetime))) },
						{ term: 'Requested from', value: request.requester_network || 'Unknown address' },
						{ term: 'Your address', value: request.approver_address || 'Unknown address' },
						{ term: 'Code expires', value: expiresIn(request.code_expires_at) },
						{ term: 'Name the browser gave', value: request.label, detail: nameDetail },
					]}
				/>

				<SegmentedControl
					label="Valid for"
					name="lifetime_days"
					value={lifetime}
					options={lifetimes.map((d) => ({ value: String(d), label: `${d} days` }))}
					onchange={(v) => (lifetimePick = v)}
				/>

				{#if drawer?.approvalUnavailable}
					<Alert tone="warn">{SAID.approvalUnavailable}</Alert>
				{:else}
					<StepUpField id="connected-editors-step-up" {mfa} bind:value={secret} error={drawer?.stepUp?.field} />
				{/if}

				{#if drawer?.checkUnavailable}
					<Alert tone="warn">
						<p>{SAID.checkUnavailable}</p>
						<div class="mt-3">
							<Button variant="secondary" size="sm" type="submit" disabled={!approveReady}>
								<RefreshCw size={ICON.sm} aria-hidden="true" /> Try again
							</Button>
						</div>
					</Alert>
				{/if}

				<div class="flex flex-wrap items-center justify-end gap-2">
					{#if approveBlocked}
						<span id="approve-blocked" class="text-sm text-muted">{approveBlocked}</span>
					{/if}
					<Button variant="ghost" onclick={close}>Cancel</Button>
					<Button
						variant="secondary"
						type="submit"
						formaction="?/decline"
						formnovalidate
						loading={pending === 'decline'}
						disabled={!request || !online}
					>
						Decline
					</Button>
					<Button
						variant="primary"
						type="submit"
						loading={pending === 'approve'}
						disabled={!approveReady}
						aria-describedby={approveBlocked ? 'approve-blocked' : undefined}
					>
						Approve
					</Button>
				</div>
			</form>
		{:else}
			<div class="flex flex-wrap items-center justify-end gap-2">
				<span id="approve-blocked" class="text-sm text-muted">{approveBlocked}</span>
				<Button variant="ghost" onclick={close}>Cancel</Button>
				<Button variant="primary" type="button" disabled aria-describedby="approve-blocked">Approve</Button>
			</div>
		{/if}
	</div>
</Drawer>
