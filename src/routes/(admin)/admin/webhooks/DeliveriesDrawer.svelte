<script lang="ts">
	import { Badge, Button, Drawer, EmptyState, Table } from '@lyeve-labs/ui-kit';
	import type { WebhookDelivery } from '@lyeve-labs/client';
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import { CheckCircle, XCircle, History, RotateCcw } from '@lucide/svelte';
	import FormErrors from '$lib/components/FormErrors.svelte';
	import { formRefusal, refusalText, type Refusal } from '$lib/api/refusal';
	import { formatDateTime } from '$lib/format';
	import { ICON } from '$lib/icon';
	import { eventTone } from './event-tone';
	import type { DeliveryHistory } from './delivery-history.svelte';

	interface Props {
		/** The page's one action result, which carries the history and each retry. */
		form: Record<string, unknown> | null | undefined;
		history: DeliveryHistory;
		/** The license refusal a paid write met, which holds the retry. */
		held?: Refusal | null;
	}

	let { form, history, held = null }: Props = $props();

	// A failed retry shows here, beside the row that asked, not behind the panel.
	const failure = $derived(form?.action === 'retry-delivery' ? (form as { error?: string }) : null);

	// The plugin answers the newest attempts up to the limit asked and offers
	// no offset, so a full page says the older ones are not listed.
	let limit = $state(0);

	// Two rows asked in quick succession can answer out of order. A history
	// applies only to the webhook the drawer names last, or its rows would show
	// under another webhook's name and each retry would post that webhook's id.
	// The name is read untracked, so naming a row never replays an old result.
	$effect(() => {
		if (form && 'deliveries' in form && form.deliveries) {
			const d = form.deliveries as { id: string; items: WebhookDelivery[] };
			if (d.id !== untrack(() => history.webhookId)) return;
			history.items = d.items ?? [];
			limit = (d as { limit?: number }).limit ?? 0;
			history.open = true;
		}
	});

	let retryResults = $state<Record<string, { success: boolean; message: string }>>({});

	// The map is read untracked: an effect that tracks the map it rewrites
	// reruns on its own write until Svelte stops it.
	$effect(() => {
		if (form && 'retryResult' in form && form.retryResult) {
			const r = form.retryResult as { delivery_id: string; success: boolean; message: string };
			retryResults = { ...untrack(() => retryResults), [r.delivery_id]: { success: r.success, message: r.message } };
		}
	});
</script>

<Drawer bind:open={history.open} title="Delivery history for {history.webhookName}" size="xl">
	{#snippet children()}
			<FormErrors message={failure?.error || undefined} refused={formRefusal(failure)} />
			{#if held}
				<p class="mb-2 text-xs text-muted" data-testid="retry-held">{refusalText(held)} Retrying a delivery needs it.</p>
			{/if}
			{#if history.items.length === 0}
				<EmptyState
					title="No deliveries recorded yet"
					description="Every attempt this webhook makes is listed here."
				>
					{#snippet iconSnippet()}<History size={ICON.lg} />{/snippet}
				</EmptyState>
			{:else}
				{#if limit > 0 && history.items.length >= limit}
					<p class="mb-2 text-xs text-muted">The newest {limit} attempts. Older attempts are kept, and this list does not reach them.</p>
				{/if}
				<Table label="Delivery history">
					<thead>
						<tr>
							<th scope="col">Time</th>
							<th scope="col">Event</th>
							<th scope="col">Schema</th>
							<th scope="col">Status</th>
							<th scope="col">Duration</th>
							<th scope="col">Result</th>
							<th scope="col">Retry</th>
						</tr>
					</thead>
					<tbody>
						{#each history.items as d (d.id)}
							<tr>
								<td class="font-mono text-xs whitespace-nowrap text-muted">
									{formatDateTime(d.attempted_at)}
								</td>
								<td><Badge tone={eventTone(d.event_type)}>{d.event_type}</Badge></td>
								<td data-cell="nowrap">{d.schema_name}</td>
								<td data-cell="nowrap" class="font-mono text-xs">
									{#if d.status_code != null}
										<span class={d.success ? 'text-success' : 'text-danger'}>{d.status_code}</span>
									{:else}
										<span class="text-faint">No response</span>
									{/if}
								</td>
								<td data-cell="nowrap" class="text-xs text-muted">
									{d.duration_ms != null ? `${d.duration_ms}ms` : 'Not recorded'}
								</td>
								<td data-cell="nowrap">
									{#if d.success}
										<span class="flex items-center gap-1 text-xs text-success">
											<CheckCircle class="h-3.5 w-3.5" /> OK
										</span>
									{:else if d.error}
										<span class="flex items-center gap-1 text-xs text-danger" title={d.error}>
											<XCircle class="h-3.5 w-3.5" />
											{d.error.slice(0, 40)}
										</span>
									{:else}
										<span class="flex items-center gap-1 text-xs text-danger">
											<XCircle class="h-3.5 w-3.5" /> Failed
										</span>
									{/if}
								</td>
								<td>
									{#if !d.success}
										<form method="POST" action="?/retry-delivery" use:enhance>
											<input type="hidden" name="id" value={history.webhookId} />
											<input type="hidden" name="delivery_id" value={d.id} />
											<Button
												variant="ghost"
												size="sm"
												type="submit"
												disabled={held !== null}
												title="Retry this delivery"
												aria-label="Retry the delivery attempted at {formatDateTime(
													d.attempted_at
												)}"
											>
												<RotateCcw class="h-3.5 w-3.5" />
											</Button>
										</form>
									{/if}
									<!-- The plugin answers a retry under the failed delivery's own id,
									     so the result shows under that row's button, which stays for
									     another try. -->
									{#if retryResults[d.id]}
										{@const rr = retryResults[d.id]}
										<span class="text-xs {rr.success ? 'text-success' : 'text-danger'}">
											{rr.message.slice(0, 30)}
										</span>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</Table>
			{/if}
		{/snippet}
		{#snippet footer()}
			<Button variant="secondary" type="button" onclick={() => (history.open = false)}>
				Close
			</Button>
		{/snippet}
</Drawer>
