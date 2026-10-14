<script lang="ts">
	import {
		Alert,
		Badge,
		Button,
		EmptyState,
		PageShell,
		SectionHeading,
		Stat,
		Table,
		Pagination,
	} from '@lyeve-labs/ui-kit';
	import { enhance } from '$app/forms';
	import { confirmed } from '$lib/forms.svelte';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { Copy, Gauge, Pencil, Plus, RotateCcw, ShieldBan, Trash2 } from '@lucide/svelte';
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
		type Protection,
		type RateRule,
	} from '$lib/api/rate-limit';
	import type { ActionData, PageData } from './$types';
	import { pageHref, pageNumber } from '$lib/api/list';
	import { ICON } from '$lib/icon';
	import RuleDrawer from './RuleDrawer.svelte';
	import GlobalDrawer from './GlobalDrawer.svelte';
	import ProtectionDrawer from './ProtectionDrawer.svelte';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	/*
	 * Every form here reports through the one `form`, so each failure names the
	 * action that caused it. A drawer shows only its own action's failure, and
	 * only one that came back after it opened, so a failed delete never reads
	 * as a failure of the next form opened. The page shows the row actions'.
	 */
	const failure = $derived(form as { action?: string; error?: string } | null);
	let openedOver = $state.raw<unknown>(null);
	const fresh = $derived(form !== openedOver);
	const failureOf = (action: string) => (fresh && failure?.action === action ? (failure.error ?? '') : '');
	const ruleError = $derived(failureOf('rule'));
	const globalError = $derived(failureOf('global'));
	const protectionError = $derived(failureOf('protection'));
	const formError = $derived(
		failure?.action === 'delete' || failure?.action === 'resetProtection' ? (failure.error ?? '') : '',
	);
	const blocking = $derived(data.rules.filter(blocksEverything));
	const live = $derived(data.status.ok ? data.status.value : []);
	const spent = $derived(exhausted(live));
	const overview = $derived(data.overview);
	// Unknown is its own state: a failed read is neither locked nor unlocked.
	const customEnabled = $derived(overview?.custom_licensed ?? null);
	const unenforced = $derived(data.rules.filter((r) => !r.enforced));
	const canEditProtections = $derived(data.superAdmin && customEnabled === true);

	/**
	 * Whether this reader may change or delete a rule. A rule with no tenant
	 * applies to every tenant, and the plugin keeps those for a super admin, so
	 * an admin sees them listed beside their own and cannot change them.
	 */
	const canChange = (r: RateRule) => data.superAdmin || Boolean(r.tenant_id);

	/*
	 * Each drawer owns its fields and is opened through the function it
	 * exports. The page stamps the result each one opened over, because the
	 * failure tags above are read against that one stamp.
	 */
	let ruleDrawer = $state<ReturnType<typeof RuleDrawer>>();
	let globalDrawer = $state<ReturnType<typeof GlobalDrawer>>();
	let protectionDrawer = $state<ReturnType<typeof ProtectionDrawer>>();

	function openCreate() {
		openedOver = form;
		ruleDrawer?.openCreate();
	}

	function openEdit(r: RateRule) {
		openedOver = form;
		ruleDrawer?.openEdit(r);
	}

	function openDuplicate(r: RateRule) {
		openedOver = form;
		ruleDrawer?.openDuplicate(r, data.rules.map((x) => x.endpoint));
	}

	function openGlobal() {
		openedOver = form;
		globalDrawer?.openGlobal(overview?.global);
	}

	function openProtection(p: Protection) {
		openedOver = form;
		protectionDrawer?.openProtection(p);
	}

	function removeRule(r: RateRule): SubmitFunction {
		return confirmed(
			`Delete rule ${r.endpoint}`,
			r.enforced
				? 'That endpoint stops being limited by it immediately.'
				: 'The rule is not being enforced, so nothing changes for callers.',
			{ confirmLabel: 'Delete', success: 'Rule deleted' },
		);
	}

	function resetOne(p: Protection): SubmitFunction {
		return confirmed(
			`Reset ${p.name}?`,
			`It returns to ${windowLabel(p.default_requests, p.default_window_seconds)}.`,
			{ confirmLabel: 'Reset', success: `Reset ${p.name}` },
		);
	}
</script>

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
				value={data.status.ok ? spent.length : '?'}
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
										{#if !canChange(r)}
											<span class="text-xs text-muted">Only a super admin changes a rule for every tenant.</span>
										{/if}
										{#if customEnabled === true && canChange(r)}
											<Button
												variant="ghost"
												size="sm"
												aria-label="Edit the rule for {r.endpoint}"
												onclick={() => openEdit(r)}
											>
												<Pencil size={ICON.sm} />
											</Button>
										{/if}
										{#if customEnabled === true}
											<Button
												variant="ghost"
												size="sm"
												aria-label="Duplicate the rule for {r.endpoint}"
												onclick={() => openDuplicate(r)}
											>
												<Copy size={ICON.sm} />
											</Button>
										{/if}
										{#if canChange(r)}
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
										{/if}
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
			{#if !data.status.ok}
				<GateNotice gate={data.status.gate} title="Live counters" absent="The rate-limit plugin is not part of this build." />
			{:else if live.length === 0}
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
						{#each live as s (s.rule_id + s.client_ip + s.endpoint)}
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

<RuleDrawer bind:this={ruleDrawer} error={ruleError} routes={data.routes} superAdmin={data.superAdmin} />

<GlobalDrawer bind:this={globalDrawer} error={globalError} />

<ProtectionDrawer bind:this={protectionDrawer} error={protectionError} />
