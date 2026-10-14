<script lang="ts">
	import { Badge, Button, Drawer, EmptyState, Table } from '@lyeve-labs/ui-kit';
	import type { DeadLetter } from '@lyeve-labs/client';
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import { RotateCcw, Skull, Trash2, XCircle } from '@lucide/svelte';
	import FormErrors from '$lib/components/FormErrors.svelte';
	import { formRefusal } from '$lib/api/refusal';
	import { formatDateTime } from '$lib/format';
	import { ICON } from '$lib/icon';
	import { eventTone } from './event-tone';

	interface Props {
		/** The page's one action result, which carries the queue and each replay or dismissal. */
		form: Record<string, unknown> | null | undefined;
	}

	let { form }: Props = $props();

	/** The queue's own writes, whose failures this drawer draws. */
	const OWN_ACTIONS = ['dead-letter-replay', 'dead-letter-dismiss', 'dead-letter-delete'];

	let showDeadLetters = $state(false);
	let deadLetterItems = $state<DeadLetter[]>([]);
	let deadLetterTotal = $state<number | null>(null);

	$effect(() => {
		if (form && 'deadLetters' in form && form.deadLetters) {
			deadLetterItems = form.deadLetters as DeadLetter[];
			deadLetterTotal = (form.deadLetterTotal as number | null | undefined) ?? null;
			showDeadLetters = true;
		}
	});

	const failure = $derived(
		form && OWN_ACTIONS.includes(String(form.action ?? '')) ? (form as { error?: string }) : null,
	);

	/** What a row's last replay or dismissal came to. `done` means it left the queue. */
	type Outcome = { text: string; done: boolean };
	let deadLetterResults = $state<Record<string, Outcome>>({});

	/**
	 * The plugin marks an entry replayed only when the receiver answers 2xx,
	 * and reports the receiver's code beside a status that always reads
	 * "replayed", so the code is what says whether it was delivered.
	 */
	function replayOutcome(code: unknown): Outcome {
		if (typeof code !== 'number') return { text: 'Replayed. The receiver sent no status.', done: false };
		if (code >= 200 && code < 300) return { text: `Delivered (HTTP ${code})`, done: true };
		return { text: `The receiver answered HTTP ${code}. The entry is still pending.`, done: false };
	}

	// The map is read untracked: an effect that tracks the map it rewrites
	// reruns on its own write until Svelte stops it.
	$effect(() => {
		if (form && 'deadLetterReplay' in form && form.deadLetterReplay) {
			const r = form.deadLetterReplay as { id: string; http_status?: unknown };
			deadLetterResults = { ...untrack(() => deadLetterResults), [r.id]: replayOutcome(r.http_status) };
		}
		if (form && 'deadLetterDismiss' in form && form.deadLetterDismiss) {
			const r = form.deadLetterDismiss as { id: string };
			deadLetterResults = { ...untrack(() => deadLetterResults), [r.id]: { text: 'Dismissed', done: true } };
		}
	});
</script>

<Drawer bind:open={showDeadLetters} title="Dead letter queue" size="xl">
	{#snippet children()}
			<FormErrors message={failure?.error || undefined} refused={formRefusal(failure)} />
			{#if deadLetterItems.length === 0}
				<EmptyState
					title="No dead letter entries"
					description="Exhausted deliveries appear here when retries are depleted."
				>
					{#snippet iconSnippet()}<Skull size={ICON.lg} />{/snippet}
				</EmptyState>
			{:else}
				{#if deadLetterTotal !== null && deadLetterTotal > deadLetterItems.length}
					<p class="mb-2 text-xs text-faint">
						Showing {deadLetterItems.length} of {deadLetterTotal} entries.
					</p>
				{/if}
				<Table label="Dead letters">
					<thead>
						<tr>
							<th scope="col">Webhook</th>
							<th scope="col">Event</th>
							<th scope="col">Schema</th>
							<th scope="col">Attempts</th>
							<th scope="col">Last error</th>
							<th scope="col">Status</th>
							<th scope="col">Dead at</th>
							<th scope="col">Actions</th>
						</tr>
					</thead>
					<tbody>
						{#each deadLetterItems as dl (dl.id)}
							{@const outcome = deadLetterResults[dl.id]}
							<tr>
								<td data-cell="nowrap" class="text-xs font-medium text-fg">{dl.webhook_name}</td>
								<td><Badge tone={eventTone(dl.event_type)}>{dl.event_type}</Badge></td>
								<td data-cell="nowrap" class="text-xs">{dl.schema_name}</td>
								<td data-cell="nowrap" class="font-mono text-xs text-muted">{dl.total_attempts}</td>
								<td class="max-w-48 truncate text-xs text-muted" title={dl.last_error ?? ''}>
									{dl.last_error ? dl.last_error.slice(0, 60) : 'None'}
								</td>
								<td>
									{#if dl.status === 'pending'}
										<Badge tone="warn">{dl.status}</Badge>
									{:else if dl.status === 'replayed'}
										<Badge tone="success">{dl.status}</Badge>
									{:else}
										<Badge tone="neutral">{dl.status}</Badge>
									{/if}
								</td>
								<td class="font-mono text-xs whitespace-nowrap text-muted">
									{formatDateTime(dl.dead_at)}
								</td>
								<td>
									{#if outcome}
										<span class="text-xs text-muted" data-testid="dead-letter-outcome">{outcome.text}</span>
									{/if}
									{#if dl.status === 'pending' && !outcome?.done}
										<div class="flex items-center gap-1">
											<form method="POST" action="?/dead-letter-replay" use:enhance>
												<input type="hidden" name="id" value={dl.id} />
												<Button
													variant="ghost"
													size="sm"
													type="submit"
													title="Replay"
													aria-label="Replay the dead letter from {dl.webhook_name}"
												>
													<RotateCcw class="h-3.5 w-3.5" />
												</Button>
											</form>
											<form method="POST" action="?/dead-letter-dismiss" use:enhance>
												<input type="hidden" name="id" value={dl.id} />
												<Button
													variant="ghost"
													size="sm"
													type="submit"
													title="Dismiss"
													aria-label="Dismiss the dead letter from {dl.webhook_name}"
												>
													<XCircle class="h-3.5 w-3.5" />
												</Button>
											</form>
											<form
												method="POST"
												action="?/dead-letter-delete"
												use:enhance={() =>
													async ({ result, update }) => {
														if (result.type === 'success') {
															deadLetterItems = deadLetterItems.filter((x) => x.id !== dl.id);
														}
														await update({ reset: false });
													}}
											>
												<input type="hidden" name="id" value={dl.id} />
												<Button
													variant="ghost"
													size="sm"
													type="submit"
													title="Delete permanently"
													aria-label="Delete the dead letter from {dl.webhook_name} permanently"
												>
													<Trash2 class="h-3.5 w-3.5 text-danger" />
												</Button>
											</form>
										</div>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</Table>
			{/if}
		{/snippet}
		{#snippet footer()}
			<Button variant="secondary" type="button" onclick={() => (showDeadLetters = false)}>
				Close
			</Button>
		{/snippet}
</Drawer>
