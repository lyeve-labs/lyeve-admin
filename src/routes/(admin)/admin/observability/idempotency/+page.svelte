<script lang="ts">
	import PageTitle from '$lib/components/PageTitle.svelte';
	import {
		Alert,
		Badge,
		Button,
		EmptyState,
		PageShell,
		SectionHeading,
		Stat,
		Table,
		confirm as confirmDialog,
		toast,
		Pagination,
	} from '@lyeve-labs/ui-kit';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { KeyRound, Unlock } from '@lucide/svelte';
	import {
		ABANDONED_AFTER_SECONDS,
		abandoned,
		ageLabel,
		ageSeconds,
		keyLabel,
		keyTone,
		replaysServed,
		type IdempotencyKey,
	} from '$lib/api/idempotency';
	import { formatDateTime } from '$lib/format';
	import type { ActionData, PageData } from './$types';
	import { pageHref, pageNumber } from '$lib/api/list';
	import { ICON } from '$lib/icon';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const formError = $derived((form as { error?: string } | null)?.error ?? '');
	const orphans = $derived(abandoned(data.keys));
	const replays = $derived(replaysServed(data.keys));

	/**
	 * Releasing a key is the repair for one whose process died mid-write, and
	 * the wrong thing to do to a request that is genuinely still running: the
	 * write would then happen twice, which is what the key exists to prevent.
	 */
	function release(k: IdempotencyKey): SubmitFunction {
		return async ({ cancel }) => {
			const confirmed = await confirmDialog(
				'Release this key?',
				'The next request carrying it runs the handler again. If the original request is still running, the write happens twice, which is what the key exists to prevent.',
				{ confirmLabel: 'Release' },
			);
			if (!confirmed) {
				cancel();
				return;
			}
			return async ({ result, update }) => {
				await update();
				if (result.type === 'success') toast.success('Key released');
			};
		};
	}
</script>

<PageTitle title="Idempotency" />

<PageShell
	title="Idempotency"
	description="Request keys the engine is holding, and the responses stored against them."
	width="wide"
	back={{ href: '/admin/observability', label: 'Observability' }}
>
	{#if data.gate.state !== 'ok'}
		<GateNotice
			gate={data.gate}
			title="Idempotency"
			absent="The idempotency plugin is not part of this build, so a repeated request runs twice."
		/>
	{:else}
		{#if formError}
			<Alert tone="danger">{formError}</Alert>
		{/if}

		{#if data.statsRead && data.stats}
			<div class="grid gap-4 sm:grid-cols-3">
				<Stat size="sm" mono label="Keys held" value={data.stats.total} />
				<Stat size="sm" mono label="With a stored response" value={data.stats.completed} />
				<Stat
					size="sm"
					mono
					label="In flight"
					value={data.stats.in_flight}
					tone={data.stats.in_flight > 0 ? 'warn' : 'neutral'}
				/>
			</div>
			<p class="text-xs text-muted">
				{replays} repeated requests on this page were answered from a stored response instead
				of running again.
			</p>
		{:else if !data.statsRead}
			<Alert tone="danger">
				The counters could not be read. The list below is one page, not the whole store.
			</Alert>
		{/if}

		{#if orphans.length > 0}
			<!-- A key is recorded before the handler finishes. One still open
			     minutes later is a process that died mid-write, and it refuses
			     every retry of that key until it expires. -->
			<Alert tone="danger">
				{orphans.length}
				{orphans.length === 1 ? 'key has' : 'keys have'} been open for more than
				{ABANDONED_AFTER_SECONDS} seconds. No handler runs that long, so these are requests
				whose process died before storing a response. Every retry carrying one of these keys
				is refused until it expires, which reads to the caller as a write that was accepted
				and never happened.
			</Alert>
		{/if}

		<section class="flex flex-col gap-4">
			<SectionHeading level={2}>Keys</SectionHeading>
			{#if data.keys.length === 0}
				<EmptyState
					title="No key is held"
					description="No client has sent an idempotency key, or every one has expired."
				>
					{#snippet iconSnippet()}
						<KeyRound size={ICON.lg} />
					{/snippet}
				</EmptyState>
			{:else}
				<Table label="Keys">
					<thead>
						<tr>
							<th scope="col">Key</th>
							<th scope="col">Request</th>
							<th scope="col">State</th>
							<th scope="col">Replays</th>
							<th scope="col">Age</th>
							<th scope="col"><span class="sr-only">Actions</span></th>
						</tr>
					</thead>
					<tbody>
						{#each data.keys as k (k.key)}
							<tr>
								<td class="max-w-xs truncate font-mono text-xs" title={k.key}>{k.key}</td>
								<td data-cell="nowrap" class="font-mono text-xs text-faint">
									{k.method}
									{k.path}
								</td>
								<td data-cell="nowrap">
									<Badge tone={keyTone(k)} dot>{keyLabel(k)}</Badge>
								</td>
								<td data-cell="nowrap" class="font-mono text-xs">{k.replay_count}</td>
								<td data-cell="nowrap" class="text-xs text-faint" title={formatDateTime(k.created_at)}>
									{ageLabel(ageSeconds(k))}
								</td>
								<td data-cell="nowrap">
									<div class="flex justify-end">
										{#if !k.completed}
											<form method="POST" action="?/release" use:enhance={release(k)}>
												<input type="hidden" name="key" value={k.key} />
												<Button
													variant="ghost"
													size="sm"
													type="submit"
													aria-label="Release the key {k.key}"
													title="Let the next request with this key run again"
												>
													<Unlock size={ICON.sm} />
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
					count={data.keys.length}
					total={data.total ?? undefined}
					hasNext={data.hasMore}
					noun="keys"
					href={pageHref('/admin/observability/idempotency', data.limit)}
				/>
			{/if}
		</section>
	{/if}
</PageShell>
