<script lang="ts">
	import PageTitle from '$lib/components/PageTitle.svelte';
	import {
		Autocomplete,
		Alert,
		Badge,
		Button,
		Drawer,
		EmptyState,
		Input,
		PageShell,
		SectionHeading,
		Select,
		Stat,
		Table,
		Toggle,
		confirm as confirmDialog,
		toast,
		Pagination,
	} from '@lyeve-labs/ui-kit';
	import { enhance } from '$app/forms';
	import { tracked } from '$lib/forms.svelte';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { Copy, Gauge, Pencil, Plus, RotateCcw, ShieldBan, Trash2 } from '@lucide/svelte';
	import { duplicateRow } from '$lib/duplicate';
	import NotEnabled from '$lib/components/NotEnabled.svelte';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import {
		audienceLabel,
		blocksEverything,
		exhausted,
		rateLabel,
		resetsIn,
		scopeLabel,
		scopeTone,
		windowLabel,
		type KeyBy,
		type Protection,
		type RateRule,
	} from '$lib/api/rate-limit';
	import type { ActionData, PageData } from './$types';
	import { pageHref, pageNumber } from '$lib/api/list';
	import { ICON } from '$lib/icon';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const formError = $derived((form as { error?: string } | null)?.error ?? '');
	const blocking = $derived(data.rules.filter(blocksEverything));
	const spent = $derived(exhausted(data.status));
	const overview = $derived(data.overview);
	// Unknown is its own state: a failed read is neither locked nor unlocked.
	const customEnabled = $derived(overview?.custom_licensed ?? null);
	const unenforced = $derived(data.rules.filter((r) => !r.enforced));
	const canEditProtections = $derived(data.superAdmin && customEnabled === true);

	const KEY_OPTIONS = [
		{ value: 'ip', label: 'Per address' },
		{ value: 'user', label: 'Per signed-in account' },
	];

	let open = $state(false);
	let editing = $state<RateRule | null>(null);

	let endpoint = $state('*');
	let tenantId = $state('');
	let rate = $state('10');
	let burst = $state('20');
	let role = $state('');
	let keyBy = $state<KeyBy>('ip');
	let enabled = $state(true);

	function openCreate() {
		editing = null;
		endpoint = '*';
		tenantId = '';
		rate = '10';
		burst = '20';
		role = '';
		keyBy = 'ip';
		enabled = true;
		open = true;
	}

	function openEdit(r: RateRule) {
		editing = r;
		endpoint = r.endpoint;
		tenantId = r.tenant_id ?? '';
		rate = String(r.rate);
		burst = String(r.burst);
		role = r.role ?? '';
		keyBy = r.key_by ?? 'ip';
		enabled = r.enabled;
		open = true;
	}

	/**
	 * Copy a rule into the create drawer.
	 *
	 * No endpoint is involved: the row is already on screen, so this is the
	 * create form with its fields filled in. The shared helper is what keeps
	 * the four rules that matter, and the one that matters here is that the
	 * copy arrives switched off. A duplicated rate limit that starts enforcing
	 * the moment it saves is a surprise nobody asked for, and the operator has
	 * not yet changed the one field they pressed Duplicate to change.
	 *
	 * The endpoint stands in for the name, because that is what identifies a
	 * rule in this list and what a second rule has to differ in.
	 */
	function openDuplicate(r: RateRule) {
		const draft = duplicateRow(r as unknown as Record<string, unknown>, {
			nameField: 'endpoint',
			taken: data.rules.map((x) => x.endpoint),
		});
		editing = null;
		endpoint = String(draft.endpoint ?? r.endpoint);
		tenantId = String(draft.tenant_id ?? '');
		rate = String(r.rate);
		burst = String(r.burst);
		role = String(draft.role ?? '');
		// The copy keeps how the original counted callers, which is part of
		// the shape somebody pressed Duplicate for.
		keyBy = r.key_by ?? 'ip';
		enabled = false;
		open = true;
	}

	let globalOpen = $state(false);
	let globalRate = $state('50');
	let globalBurst = $state('100');
	let globalEnabled = $state(false);

	function openGlobal() {
		const g = overview?.global;
		globalRate = String(g?.rate ?? 50);
		globalBurst = String(g?.burst ?? 100);
		globalEnabled = g?.enabled ?? false;
		globalOpen = true;
	}

	let protectionOpen = $state(false);
	let protection = $state<Protection | null>(null);
	let protectionRequests = $state('5');
	let protectionMinutes = $state('15');

	function openProtection(p: Protection) {
		protection = p;
		protectionRequests = String(p.requests);
		protectionMinutes = String(p.window_seconds / 60);
		protectionOpen = true;
	}

	function closing(close: () => void, message: string): SubmitFunction {
		return () =>
			async ({ result, update }) => {
				if (result.type !== 'failure') close();
				await update();
				if (result.type === 'success') toast.success(message);
			};
	}

	const saveRule: SubmitFunction = () => {
		const subject = endpoint;
		const verb = editing ? 'Saved' : 'Created';
		return async ({ result, update }) => {
			if (result.type !== 'failure') open = false;
			await update();
			if (result.type === 'success') toast.success(`${verb} ${subject}`);
		};
	};

	function removeRule(r: RateRule): SubmitFunction {
		return async ({ cancel }) => {
			const confirmed = await confirmDialog(
				`Delete the rule for ${r.endpoint}?`,
				r.enforced
					? 'That endpoint stops being limited by it immediately.'
					: 'The rule is not being enforced, so nothing changes for callers.',
				{ confirmLabel: 'Delete' },
			);
			if (!confirmed) {
				cancel();
				return;
			}
			return async ({ result, update }) => {
				await update();
				if (result.type === 'success') toast.success('Rule deleted');
			};
		};
	}

	function resetOne(p: Protection): SubmitFunction {
		return async ({ cancel }) => {
			const confirmed = await confirmDialog(
				`Reset ${p.name}?`,
				`It returns to ${windowLabel(p.default_requests, p.default_window_seconds)}.`,
				{ confirmLabel: 'Reset' },
			);
			if (!confirmed) {
				cancel();
				return;
			}
			return async ({ result, update }) => {
				await update();
				if (result.type === 'success') toast.success(`Reset ${p.name}`);
			};
		};
	}

	const saveRuleSubmit = tracked(saveRule);
	const saveGlobalSubmit = tracked(closing(() => (globalOpen = false), 'Saved the global limit'));
	const saveProtectionSubmit = tracked(closing(() => (protectionOpen = false), 'Saved the protection'));
</script>

<PageTitle title="Rate limits" />

<PageShell
	title="Rate limits"
	description="Every limit a request passes through, and who is close to one right now."
	width="wide"
	back={{ href: '/admin/settings', label: 'Settings' }}
>
	{#snippet actions()}
		{#if data.gate.state === 'ok'}
			<!-- The tenant's own limit, its address lists and its refusal
			     history live on a page of their own, because a tenant admin
			     reaches them without the instance controls here. -->
			<Button variant="secondary" size="sm" href="/admin/settings/rate-limits/tenant">
				<ShieldBan size={ICON.sm} /> Tenant controls
			</Button>
		{/if}
		{#if data.gate.state === 'ok' && customEnabled === true}
			<Button variant="primary" size="sm" onclick={openCreate}>
				<Plus size={ICON.sm} /> New rule
			</Button>
		{/if}
	{/snippet}

	{#if data.gate.state !== 'ok'}
		<GateNotice
			gate={data.gate}
			title="Rate limits"
			absent="The rate limit plugin is not part of this build, so no endpoint is throttled."
		/>
	{:else}
		{#if formError}
			<Alert tone="danger">{formError}</Alert>
		{/if}
		{#if !overview}
			<Alert tone="warn">
				The global limit, the protections and whether custom rules are enabled could not be read.
				The custom rules below are shown, but whether they are enforced is unknown.
			</Alert>
		{/if}

		<div class="grid gap-4 sm:grid-cols-3">
			<Stat size="sm" mono label="Custom rules" value={data.rules.length} />
			<Stat
				size="sm"
				mono
				label="Enforced"
				value={data.rules.filter((r) => r.enforced).length}
				tone={unenforced.length > 0 ? 'warn' : 'neutral'}
			/>
			<Stat
				size="sm"
				mono
				label="Callers at their limit"
				value={data.statusRead ? spent.length : '?'}
				tone={spent.length > 0 ? 'warn' : 'neutral'}
			/>
		</div>

		{#if overview}
			<section class="flex flex-col gap-4">
				<SectionHeading level={2}>Global limit</SectionHeading>
				<Table label="Global limit">
					<thead>
						<tr>
							<th scope="col">Applies to</th>
							<th scope="col">Rate</th>
							<th scope="col">Burst</th>
							<th scope="col">State</th>
							<th scope="col"><span class="sr-only">Actions</span></th>
						</tr>
					</thead>
					<tbody>
						{#if overview.global}
							<tr>
								<td data-cell="nowrap" class="text-xs">Every request, per address, every tenant</td>
								<td data-cell="nowrap" class="text-xs text-faint">{rateLabel(overview.global.rate)}</td>
								<td data-cell="nowrap" class="font-mono text-xs">{overview.global.burst}</td>
								<td data-cell="nowrap">
									<Badge tone={overview.global.enabled ? 'success' : 'neutral'}>
										{overview.global.enabled ? 'On' : 'Off'}
									</Badge>
								</td>
								<td data-cell="nowrap">
									{#if data.superAdmin}
										<div class="flex justify-end">
											<Button
												variant="ghost"
												size="sm"
												aria-label="Edit the global limit"
												onclick={openGlobal}
											>
												<Pencil size={ICON.sm} />
											</Button>
										</div>
									{/if}
								</td>
							</tr>
						{:else}
							<tr>
								<td colspan="5" class="text-xs text-muted">
									The global limit is missing. The engine seeds it when it starts.
								</td>
							</tr>
						{/if}
					</tbody>
				</Table>
			</section>

		{/if}

		{#if overview && data.superAdmin}
			<!-- Instance-wide sign-in thresholds. The engine returns them to a
			     super admin only: on a shared instance they would tell a
			     tenant's admin how fast to pace a credential-stuffing run. -->
			<section class="flex flex-col gap-4">
				<SectionHeading level={2}>Sign-in and reset protections</SectionHeading>
				<p class="text-xs text-muted">
					Built in and enforced on every install.
					{#if customEnabled === false}
						Changing one is not enabled on this instance.
					{/if}
				</p>
				<Table label="Protections">
					<thead>
						<tr>
							<th scope="col">Protection</th>
							<th scope="col">Limit</th>
							<th scope="col">Shipped value</th>
							<th scope="col"><span class="sr-only">Actions</span></th>
						</tr>
					</thead>
					<tbody>
						{#each overview.protections as p (p.name)}
							<tr>
								<td>
									<span class="font-mono text-xs text-fg">{p.name}</span>
									<span class="block text-xs text-muted">{p.description}</span>
								</td>
								<td data-cell="nowrap" class="text-xs">
									{windowLabel(p.requests, p.window_seconds)}
									{#if p.customized}
										<Badge tone="warn">Changed</Badge>
									{/if}
								</td>
								<td data-cell="nowrap" class="text-xs text-faint">
									{windowLabel(p.default_requests, p.default_window_seconds)}
								</td>
								<td data-cell="nowrap">
									<div class="flex items-center justify-end gap-1">
										{#if canEditProtections}
											<Button
												variant="ghost"
												size="sm"
												aria-label="Edit {p.name}"
												onclick={() => openProtection(p)}
											>
												<Pencil size={ICON.sm} />
											</Button>
										{/if}
										{#if data.superAdmin && p.customized}
											<form method="POST" action="?/resetProtection" use:enhance={resetOne(p)}>
												<input type="hidden" name="name" value={p.name} />
												<Button
													variant="ghost"
													size="sm"
													type="submit"
													aria-label="Reset {p.name} to its shipped value"
												>
													<RotateCcw size={ICON.sm} />
												</Button>
											</form>
										{/if}
									</div>
								</td>
							</tr>
						{/each}
					</tbody>
				</Table>
			</section>
		{/if}

		<section class="flex flex-col gap-4">
			<SectionHeading level={2}>Custom rules</SectionHeading>
			{#if customEnabled === false}
				<NotEnabled
					title="Custom rate limits"
					description="Limit an endpoint pattern, a tenant or a role on its own, count by address or by signed-in account, and change the built-in sign-in and reset limits."
				/>
				{#if data.rules.length > 0}
					<!-- Rules stay stored while the capability is off and apply again
					     when it is on. An endpoint somebody protected is unprotected
					     until then, and the page says so rather than listing them as
					     live. -->
					<Alert tone="warn">
						{data.rules.length}
						{data.rules.length === 1 ? 'stored rule is' : 'stored rules are'} not enforced on
						this instance. They apply again when custom rules are enabled, and deleting one is
						allowed either way.
					</Alert>
				{/if}
			{/if}

			{#if blocking.length > 0}
				<!-- A stored rule with a burst of zero is a closed door whatever
				     the rate says. -->
				<Alert tone="danger">
					{blocking.length}
					{blocking.length === 1 ? 'rule blocks' : 'rules block'} every request, not just excess
					ones: a burst or a rate of zero leaves the first request with no token to take.
				</Alert>
			{/if}

			{#if data.rules.length === 0}
				{#if customEnabled !== false}
					<EmptyState
						title="No custom rule is configured"
						description="Only the global limit and the protections above apply."
					>
						{#snippet iconSnippet()}
							<Gauge size={ICON.lg} />
						{/snippet}
						{#snippet action()}
							{#if customEnabled === true}
								<Button variant="secondary" onclick={openCreate}>
									<Plus size={ICON.sm} /> New rule
								</Button>
							{/if}
						{/snippet}
					</EmptyState>
				{/if}
			{:else}
				<Table label="Custom rules">
					<thead>
						<tr>
							<th scope="col">Endpoint</th>
							<th scope="col">Tenant</th>
							<th scope="col">Who</th>
							<th scope="col">Rate</th>
							<th scope="col">Burst</th>
							<th scope="col"><span class="sr-only">Actions</span></th>
						</tr>
					</thead>
					<tbody>
						{#each data.rules as r (r.id)}
							<tr>
								<td data-cell="nowrap">
									<span class="font-mono text-xs text-fg">{r.endpoint}</span>
									{#if !r.enabled}
										<Badge tone="neutral">Disabled</Badge>
									{:else if !r.enforced}
										<Badge tone="warn">Not enforced</Badge>
									{:else if blocksEverything(r)}
										<Badge tone="danger">Blocks everything</Badge>
									{/if}
								</td>
								<td data-cell="nowrap">
									<!-- An empty tenant means every tenant, which is what
									     leaving the field blank gives you. An empty cell
									     would read as "not applicable". -->
									<Badge tone={scopeTone(r)}>{scopeLabel(r)}</Badge>
								</td>
								<td data-cell="nowrap" class="text-xs">{audienceLabel(r)}</td>
								<td data-cell="nowrap" class="text-xs text-faint">{rateLabel(r.rate)}</td>
								<td data-cell="nowrap" class="font-mono text-xs">{r.burst}</td>
								<td data-cell="nowrap">
									<div class="flex items-center justify-end gap-1">
										{#if customEnabled === true}
											<Button
												variant="ghost"
												size="sm"
												aria-label="Edit the rule for {r.endpoint}"
												onclick={() => openEdit(r)}
											>
												<Pencil size={ICON.sm} />
											</Button>
											<Button
												variant="ghost"
												size="sm"
												aria-label="Duplicate the rule for {r.endpoint}"
												onclick={() => openDuplicate(r)}
											>
												<Copy size={ICON.sm} />
											</Button>
										{/if}
										<form method="POST" action="?/delete" use:enhance={removeRule(r)}>
											<input type="hidden" name="id" value={r.id} />
											<Button
												variant="ghost"
												size="sm"
												type="submit"
												aria-label="Delete the rule for {r.endpoint}"
											>
												<Trash2 size={ICON.sm} class="text-danger" />
											</Button>
										</form>
									</div>
								</td>
							</tr>
						{/each}
					</tbody>
				</Table>
				<Pagination
					page={pageNumber(data.offset, data.limit)}
					perPage={data.limit}
					count={data.rules.length}
					total={data.total ?? undefined}
					hasNext={data.hasMore}
					noun="rules"
					href={pageHref('/admin/settings/rate-limits', data.limit)}
				/>
			{/if}
		</section>

		{#if overview && overview.engine.length > 0}
			<section class="flex flex-col gap-4">
				<SectionHeading level={2}>Engine limits</SectionHeading>
				<p class="text-xs text-muted">
					Set in the engine's environment and read when it starts, so they are shown here and
					changed there, followed by a restart. A request passes these as well as everything above.
				</p>
				<Table label="Engine limits">
					<thead>
						<tr>
							<th scope="col">Endpoint</th>
							<th scope="col">Rate</th>
							<th scope="col">Burst</th>
							<th scope="col">Set by</th>
						</tr>
					</thead>
					<tbody>
						{#each overview.engine as e (e.scope + e.endpoint)}
							<tr>
								<td data-cell="nowrap">
									<span class="font-mono text-xs text-fg">{e.endpoint}</span>
									{#if e.scope === 'global'}
										<Badge tone="neutral">{e.per_tenant ? 'Per tenant and address' : 'Per address'}</Badge>
									{/if}
								</td>
								<td data-cell="nowrap" class="text-xs text-faint">{rateLabel(e.rate)}</td>
								<td data-cell="nowrap" class="font-mono text-xs">{e.burst}</td>
								<td data-cell="nowrap">
									<Badge tone={e.source === 'environment' ? 'brand' : 'neutral'}>
										{e.source === 'environment' ? e.setting : 'Shipped default'}
									</Badge>
								</td>
							</tr>
						{/each}
					</tbody>
				</Table>
			</section>
		{/if}

		<section class="flex flex-col gap-4">
			<SectionHeading level={2}>Right now</SectionHeading>
			{#if !data.statusRead}
				<Alert tone="danger">
					The live counters could not be read. This is not a report that nobody is being
					throttled.
				</Alert>
			{:else if data.status.length === 0}
				<EmptyState
					title="Nobody is near a limit"
					description="No caller has spent enough of a window for the limiter to be tracking it."
				>
					{#snippet iconSnippet()}
						<Gauge size={ICON.lg} />
					{/snippet}
				</EmptyState>
			{:else}
				<Table label="Right now">
					<thead>
						<tr>
							<th scope="col">Caller</th>
							<th scope="col">Endpoint</th>
							<th scope="col">Left</th>
							<th scope="col">Resets in</th>
						</tr>
					</thead>
					<tbody>
						{#each data.status as s (s.rule_id + s.client_ip + s.endpoint)}
							<tr>
								<td data-cell="nowrap" class="font-mono text-xs">{s.client_ip}</td>
								<td data-cell="nowrap" class="font-mono text-xs text-faint">{s.endpoint}</td>
								<td data-cell="nowrap">
									<Badge tone={s.remaining <= 0 ? 'danger' : 'neutral'}>
										{s.remaining} of {s.burst}
									</Badge>
								</td>
								<td data-cell="nowrap" class="text-xs text-faint">{resetsIn(s.reset_at)}</td>
							</tr>
						{/each}
					</tbody>
				</Table>
				<p class="text-xs text-muted">
					A snapshot from the process that answered this request. On more than one node each
					keeps its own counters unless the distributed store is configured.
				</p>
			{/if}
		</section>
	{/if}
</PageShell>

<Drawer bind:open title={editing ? 'Edit rule' : 'New rule'}>
	<form
		id="rate-rule-form"
		method="POST"
		action={editing ? '?/update' : '?/create'}
		use:enhance={saveRuleSubmit.enhance}
	>
		{#if editing}
			<input type="hidden" name="id" value={editing.id} />
		{/if}

		<div class="flex flex-col gap-4">
			<Autocomplete
				id="rl-route"
				label="Pick a route"
				hint="Every route this instance serves, including plugin routes such as the realtime stream and GraphQL, and the URLs your flows answer. Picking one fills the endpoint below."
				placeholder="Search by path, method or name"
				options={data.routes}
				onchange={(v) => {
					if (v) endpoint = v;
				}}
			/>
			<Input
				id="rl-endpoint"
				name="endpoint"
				label="Endpoint"
				hint="* for every request, or a method and a path. A segment may be {'{name}'}, and the last may be * for everything below it."
				bind:value={endpoint}
				required
			/>
			{#if data.superAdmin}
				<Input
					id="rl-tenant"
					name="tenant_id"
					label="Tenant"
					hint="Leave empty to apply the rule to every tenant."
					bind:value={tenantId}
				/>
			{/if}
			<Input
				id="rl-role"
				name="role"
				label="Role"
				hint="Leave empty for every caller. anonymous matches callers who are not signed in."
				bind:value={role}
			/>
			<Select
				id="rl-key"
				name="key_by"
				label="Count"
				hint="Per account shares one budget across every address an account calls from. A caller who is not signed in is counted by address."
				bind:value={keyBy}
				options={KEY_OPTIONS}
			/>
			<div class="grid gap-4 sm:grid-cols-2">
				<Input
					id="rl-rate"
					name="rate"
					label="Requests per second"
					hint="Sustained. How fast the allowance refills."
					bind:value={rate}
				/>
				<Input
					id="rl-burst"
					name="burst"
					label="Burst"
					hint="How many requests can arrive at once. At least one."
					bind:value={burst}
				/>
			</div>
			<!-- Toggle renders a button, which submits nothing, and the action
			     reads an absent field as off. -->
			<input type="hidden" name="enabled" value={enabled ? 'true' : 'false'} />
			<Toggle id="rl-enabled" label="Enforce this rule" bind:checked={enabled} />
		</div>
	</form>
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (open = false)}>Cancel</Button>
		<Button variant="primary" type="submit" form="rate-rule-form" loading={saveRuleSubmit.pending}>
			{editing ? 'Save' : 'Create'}
		</Button>
	{/snippet}
</Drawer>

<Drawer bind:open={globalOpen} title="Global limit">
	<form id="rate-global-form" method="POST" action="?/global" use:enhance={saveGlobalSubmit.enhance}>
		<div class="flex flex-col gap-4">
			<div class="grid gap-4 sm:grid-cols-2">
				<Input
					id="rl-global-rate"
					name="rate"
					label="Requests per second"
					hint="Per address, across every route."
					bind:value={globalRate}
				/>
				<Input
					id="rl-global-burst"
					name="burst"
					label="Burst"
					hint="How many requests can arrive at once."
					bind:value={globalBurst}
				/>
			</div>
			<input type="hidden" name="enabled" value={globalEnabled ? 'true' : 'false'} />
			<Toggle id="rl-global-enabled" label="Enforce the global limit" bind:checked={globalEnabled} />
		</div>
	</form>
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (globalOpen = false)}>Cancel</Button>
		<Button variant="primary" type="submit" form="rate-global-form" loading={saveGlobalSubmit.pending}>
			Save
		</Button>
	{/snippet}
</Drawer>

<Drawer bind:open={protectionOpen} title={protection ? protection.name : 'Protection'}>
	<form
		id="rate-protection-form"
		method="POST"
		action="?/protection"
		use:enhance={saveProtectionSubmit.enhance}
	>
		<div class="flex flex-col gap-4">
			{#if protection}
				<input type="hidden" name="name" value={protection.name} />
				<p class="text-xs text-muted">
					{protection.description} Shipped at {windowLabel(
						protection.default_requests,
						protection.default_window_seconds,
					)}.
				</p>
			{/if}
			<div class="grid gap-4 sm:grid-cols-2">
			<Input
				id="rl-protection-requests"
				name="requests"
				label="Requests"
				hint="At least one. Zero would lock everyone out."
				bind:value={protectionRequests}
			/>
			<Input
				id="rl-protection-window"
				name="window_minutes"
				label="Window in minutes"
				hint="At most a day."
				bind:value={protectionMinutes}
				/>
			</div>
		</div>
	</form>
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (protectionOpen = false)}>Cancel</Button>
		<Button
			variant="primary"
			type="submit"
			form="rate-protection-form"
			loading={saveProtectionSubmit.pending}
		>
			Save
		</Button>
	{/snippet}
</Drawer>
