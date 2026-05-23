<script lang="ts">
	import PageTitle from '$lib/components/PageTitle.svelte';
	import RefusalNotice from '$lib/components/RefusalNotice.svelte';
	import { filtersText, keptJSON, type WebhookRecord } from '$lib/api/webhook-options';
	import { formRefusal } from '$lib/api/refusal';
	import {
		Alert,
		Badge,
		Button,
		CheckboxGroup,
		Drawer,
		EmptyState,
		Input,
		PageShell,
		Pagination,
		PasswordInput,
		SearchInput,
		SegmentedControl,
		toast,
		Table,
		Textarea,
		Toggle,
		confirm as confirmDialog,
		type ChoiceOption
	} from '@lyeve-labs/ui-kit';
	import type { PageData, ActionData } from './$types';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { Webhook, WebhookDelivery, DeadLetter } from '@lyeve-labs/client';
	import { enhance } from '$app/forms';
	import { fieldErrors, submitter } from '$lib/forms.svelte';
	import {
		Plus,
		Copy,
		Pencil,
		Trash2,
		Webhook as WebhookIcon,
		FlaskConical,
		CheckCircle,
		XCircle,
		History,
		RotateCcw,
		KeyRound,
		Skull
	} from '@lucide/svelte';
	import { duplicateRow } from '$lib/duplicate';
	import ListToolbar from '$lib/components/ListToolbar.svelte';
	import { formatDateTime } from '$lib/format';
	import { narrows } from '$lib/narrow';
	import { pageHref, pageNumber } from '$lib/api/list';
	import { ICON } from '$lib/icon';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	const pageRefusal = $derived(formRefusal(form));

	const submit = submitter(() => (open = false));

	// The options carry their own `name`, so each ticked box posts its own value
	// and the action's getAll('events') sees a list. One hidden field holding
	// the joined selection would arrive as a single comma-joined string and be
	// stored as one event named "after_create,after_update".
	const EVENT_OPTIONS: ChoiceOption[] = [
		'before_create',
		'after_create',
		'before_update',
		'after_update',
		'before_delete',
		'after_delete'
	].map((value) => ({ value, label: value }));

	const schemaOptions = $derived<ChoiceOption[]>(
		data.schemas.map((s) => ({ value: s.name, label: s.name }))
	);

	// One drawer for both writes: a null target is a new webhook.
	let open = $state(false);
	let editing = $state<Webhook | null>(null);
	let name = $state('');
	let url = $state('');
	let secret = $state('');
	let enabled = $state(true);
	let events = $state<string[]>([]);
	let schemas = $state<string[]>([]);
	// The delivery options. An edit sends back what it read, so an endpoint keeps
	// them through a change of its name.
	let template = $state('');
	let jsonpath = $state('');
	let filters = $state('');
	let maxRetries = $state('');
	let retryDelay = $state('');
	let kept = $state('{}');

	function readOptions(wh: WebhookRecord | null) {
		template = wh?.payload_template ?? '';
		jsonpath = wh?.jsonpath_filter ?? '';
		filters = filtersText(wh?.field_filters);
		maxRetries = wh?.max_retries != null ? String(wh.max_retries) : '';
		retryDelay = wh?.retry_delay_seconds != null ? String(wh.retry_delay_seconds) : '';
		kept = keptJSON(wh);
	}
	const formErrors = $derived(fieldErrors(form));

	function openCreate() {
		editing = null;
		name = '';
		url = '';
		secret = '';
		enabled = true;
		events = [];
		schemas = [];
		readOptions(null);
		open = true;
	}

	function openEdit(wh: Webhook) {
		editing = wh;
		name = wh.name;
		url = wh.url;
		secret = '';
		enabled = wh.enabled;
		events = [...wh.events];
		schemas = [...wh.schemas];
		readOptions(wh as WebhookRecord);
		open = true;
	}

	/**
	 * Copy a webhook into the create drawer.
	 *
	 * The signing secret is not copied and cannot be: it is the receiver's
	 * trust anchor, and two endpoints sharing one means rotating either
	 * breaks both. The shared helper drops it, and this sets the box empty so
	 * the new endpoint mints its own.
	 */
	function openDuplicate(wh: Webhook) {
		const draft = duplicateRow(wh as unknown as Record<string, unknown>, {
			taken: data.webhooks.map((w) => w.name),
		});
		editing = null;
		name = String(draft.name ?? wh.name);
		url = wh.url;
		secret = '';
		enabled = false;
		events = [...wh.events];
		schemas = [...wh.schemas];
		readOptions(wh as WebhookRecord);
		open = true;
	}

	// Delete goes through the kit's confirm dialog, then a hidden form, so the
	// row's button never posts on its own and the action stays a form action.
	let deleteId = $state('');
	let deleteForm = $state<HTMLFormElement>();

	async function askDelete(wh: Webhook) {
		const ok = await confirmDialog('Delete webhook', `Delete ${wh.name}? This cannot be undone.`, {
			confirmLabel: 'Delete',
		});
		if (!ok) return;
		deleteId = wh.id;
		await Promise.resolve();
		deleteForm?.requestSubmit();
	}

	// The endpoint takes no search, so the box narrows the page on screen and
	// the pager below still walks the whole collection.
	let query = $state('');
	let status = $state('');
	const STATUSES = [
		{ value: '', label: 'All' },
		{ value: 'enabled', label: 'Enabled' },
		{ value: 'disabled', label: 'Disabled' },
	];
	const visible = $derived(
		data.webhooks.filter(
			(wh) =>
				narrows(query, wh.name, wh.url, wh.events.join(' '), wh.schemas.join(' ')) &&
				(status === '' || (status === 'enabled') === wh.enabled)
		)
	);

	let testResults = $state<
		Record<string, { success: boolean; status_code: number; message: string }>
	>({});

	$effect(() => {
		if (form && 'testResult' in form && form.testResult) {
			const tr = form.testResult as {
				id: string;
				success: boolean;
				status_code: number;
				message: string;
			};
			testResults = { ...testResults, [tr.id]: tr };
		}
	});

	let showDeliveries = $state(false);
	let deliveriesWebhookId = $state('');
	let deliveriesWebhookName = $state('');
	let deliveryItems = $state<WebhookDelivery[]>([]);

	$effect(() => {
		if (form && 'deliveries' in form && form.deliveries) {
			const d = form.deliveries as { id: string; items: WebhookDelivery[] };
			deliveryItems = d.items ?? [];
			showDeliveries = true;
		}
	});

	/**
	 * Names the row being inspected, then lets the action result through.
	 *
	 * A submit handler that returns without awaiting `update()` tells SvelteKit
	 * to skip applying the result, so `form.deliveries` would never arrive and
	 * the history modal would open empty.
	 */
	function loadDeliveries(wh: Webhook): SubmitFunction {
		return () =>
			async ({ update }) => {
				deliveriesWebhookId = wh.id;
				deliveriesWebhookName = wh.name;
				deliveryItems = [];
				await update({ reset: false });
			};
	}

	/**
	 * Every write in this application reports through the toast, which is one
	 * place a reader learns to look, so a rotated secret is announced there too
	 * and not in the row.
	 */
	$effect(() => {
		if (form && 'rotateSecretResult' in form && form.rotateSecretResult) {
			const wh = form.rotateSecretResult as Webhook;
			toast.success(`Rotated the secret for ${wh.name}`);
		}
	});

	let retryResults = $state<Record<string, { success: boolean; message: string }>>({});

	$effect(() => {
		if (form && 'retryResult' in form && form.retryResult) {
			const r = form.retryResult as { delivery_id: string; success: boolean; message: string };
			retryResults = { ...retryResults, [r.delivery_id]: { success: r.success, message: r.message } };
		}
	});

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

	let deadLetterResults = $state<Record<string, string>>({});

	$effect(() => {
		if (form && 'deadLetterReplay' in form && form.deadLetterReplay) {
			const r = form.deadLetterReplay as { id: string; status: string };
			deadLetterResults = { ...deadLetterResults, [r.id]: `Replayed with status ${r.status}` };
		}
		if (form && 'deadLetterDismiss' in form && form.deadLetterDismiss) {
			const r = form.deadLetterDismiss as { id: string; status: string };
			deadLetterResults = { ...deadLetterResults, [r.id]: 'Dismissed' };
		}
	});

	function eventTone(event: string): 'success' | 'warn' {
		return event.startsWith('after_') ? 'success' : 'warn';
	}

	function truncate(url: string, max = 48): string {
		return url.length > max ? url.slice(0, max) + '...' : url;
	}

	const isSuperAdmin = $derived(data.user?.roles?.includes('super_admin') ?? false);
</script>

<PageTitle title="Webhooks" />

<PageShell
	title="Webhooks"
	description="Outgoing HTTP callbacks fired on content lifecycle events."
	width="wide"
>
	{#snippet actions()}
		<form method="POST" action="?/dead-letters" use:enhance>
			<Button variant="secondary" size="sm" type="submit" title="View dead letter queue">
				<Skull size={ICON.sm} />
				Dead letters
			</Button>
		</form>
		<Button variant="primary" size="sm" onclick={openCreate}>
			<Plus size={ICON.sm} />
			New webhook
		</Button>
	{/snippet}

	{#if pageRefusal}
		<RefusalNotice refusal={pageRefusal} />
	{:else if form && 'error' in form && form.error}
		<Alert tone="danger">
			{#snippet children()}{form.error}{/snippet}
		</Alert>
	{/if}

	{#if data.webhooks.length === 0}
		<EmptyState
			title="No webhooks configured yet"
			description="Add one to receive HTTP callbacks on content events."
		>
			{#snippet iconSnippet()}<WebhookIcon size={ICON.lg} />{/snippet}
			{#snippet action()}
				<Button variant="secondary" onclick={openCreate}>
					<Plus size={ICON.sm} />
					New webhook
				</Button>
			{/snippet}
		</EmptyState>
	{:else}
		<ListToolbar label="Filter webhooks">
			{#snippet search()}
				<label for="webhook-search" class="sr-only">Narrow this page</label>
				<SearchInput id="webhook-search" bind:value={query} placeholder="Name, URL, event or schema on this page" />
			{/snippet}
			{#snippet filters()}
				<SegmentedControl label="Status" labelHidden bind:value={status} options={STATUSES} />
			{/snippet}
		</ListToolbar>

		{#if visible.length === 0}
			<EmptyState title="No webhook on this page matches" description="Clear the search, or turn the page: the box narrows what is on screen." />
		{:else}
		<Table label="Webhooks">
			<thead>
				<tr>
					<th scope="col">Name</th>
					<th scope="col">URL</th>
					<th scope="col">Events</th>
					<th scope="col">Schemas</th>
					<th scope="col">Status</th>
					<th scope="col">Actions</th>
				</tr>
			</thead>
			<tbody>
				{#each visible as wh (wh.id)}
					<tr>
						<td data-cell="nowrap" class="font-medium text-fg">{wh.name}</td>
						<td data-cell="nowrap" class="font-mono text-xs text-muted">{truncate(wh.url)}</td>
						<td data-cell="nowrap">
							<div class="flex flex-wrap gap-1">
								{#each wh.events as ev (ev)}
									<Badge tone={eventTone(ev)}>{ev}</Badge>
								{:else}
									<span class="text-xs text-faint">None</span>
								{/each}
							</div>
						</td>
						<td>
							{#if wh.schemas.length === 0}
								<Badge tone="brand">All</Badge>
							{:else}
								<div class="flex flex-wrap gap-1">
									{#each wh.schemas as s (s)}
										<Badge tone="neutral">{s}</Badge>
									{/each}
								</div>
							{/if}
						</td>
						<td>
							{#if wh.enabled}
								<Badge tone="success" dot>Enabled</Badge>
							{:else}
								<Badge tone="neutral" dot>Disabled</Badge>
							{/if}
						</td>
						<td>
							<div class="flex items-center gap-2">
								<form method="POST" action="?/test" use:enhance>
									<input type="hidden" name="id" value={wh.id} />
									<Button
										variant="ghost"
										size="sm"
										type="submit"
										title="Test webhook"
										aria-label="Test {wh.name}"
									>
										<FlaskConical size={ICON.sm} />
									</Button>
								</form>
								<form method="POST" action="?/deliveries" use:enhance={loadDeliveries(wh)}>
									<input type="hidden" name="id" value={wh.id} />
									<Button
										variant="ghost"
										size="sm"
										type="submit"
										title="Delivery history"
										aria-label="Delivery history for {wh.name}"
									>
										<History size={ICON.sm} />
									</Button>
								</form>
								{#if isSuperAdmin}
									<form method="POST" action="?/rotate-secret" use:enhance>
										<input type="hidden" name="id" value={wh.id} />
										<Button
											variant="ghost"
											size="sm"
											type="submit"
											title="Rotate signing secret"
											aria-label="Rotate the signing secret for {wh.name}"
										>
											<KeyRound size={ICON.sm} />
										</Button>
									</form>
								{/if}
								<Button
									variant="ghost"
									size="sm"
									onclick={() => openEdit(wh)}
									title="Edit"
									aria-label="Edit {wh.name}"
								>
									<Pencil size={ICON.sm} />
								</Button>
								<Button
									variant="ghost"
									size="sm"
									onclick={() => openDuplicate(wh)}
									title="Duplicate"
									aria-label="Duplicate {wh.name}"
								>
									<Copy size={ICON.sm} />
								</Button>
								<!-- Asks first, so one click never destroys a webhook. -->
								<Button
									variant="ghost"
									size="sm"
									onclick={() => askDelete(wh)}
									title="Delete"
									aria-label="Delete {wh.name}"
								>
									<Trash2 size={ICON.sm} class="text-danger" />
								</Button>
							</div>

							{#if testResults[wh.id]}
								{@const tr = testResults[wh.id]}
								<div class="mt-1 flex items-center gap-1 text-xs">
									{#if tr.success}
										<CheckCircle size={ICON.xs} class="text-success" />
										<span class="text-success">HTTP {tr.status_code}: {tr.message}</span>
									{:else}
										<XCircle size={ICON.xs} class="text-danger" />
										<span class="text-danger">HTTP {tr.status_code}: {tr.message}</span>
									{/if}
								</div>
							{/if}

						</td>
					</tr>
				{/each}
			</tbody>
		</Table>
		{/if}

		<!-- The total is stated only when the envelope carried one. Absent is
		     not zero here, so it is left out rather than sent as a number
		     nobody measured, and the count carries the range instead. -->
		<Pagination
			page={pageNumber(data.offset, data.limit)}
			perPage={data.limit}
			count={data.webhooks.length}
			total={data.total ?? undefined}
			hasNext={data.hasMore}
			noun="webhooks"
			href={pageHref('/admin/webhooks', data.limit)}
		/>
	{/if}
</PageShell>

<Drawer bind:open title={editing ? `Edit ${editing.name}` : 'New webhook'}>
	<form
		method="POST"
		action={editing ? '?/update' : '?/create'}
		id="webhook-form"
		use:enhance={submit.enhance}
		class="flex flex-col gap-4"
	>
		{#if pageRefusal}
			<RefusalNotice refusal={pageRefusal} />
		{:else if form && 'error' in form && form.error}
			<Alert tone="danger">{form.error}</Alert>
		{/if}
		{#if editing}<input type="hidden" name="id" value={editing.id} />{/if}
		<input type="hidden" name="kept" value={kept} />
		<Input id="webhook-name" name="name" label="Name" bind:value={name} placeholder="Slack notifier" required />
		<Input id="webhook-url" name="url" label="URL" bind:value={url} placeholder="https://hooks.example.com/webhook" required />
		<PasswordInput
			id="webhook-secret"
			name="secret"
			label="Signing secret"
			hint={editing ? 'Leave blank to keep current' : 'Optional. Signs each payload with HMAC-SHA256.'}
			bind:value={secret}
		/>
		<CheckboxGroup name="events" label="Events" orientation="horizontal" options={EVENT_OPTIONS} bind:value={events} />
		<CheckboxGroup
			name="schemas"
			label="Schemas"
			hint="Leave empty to fire on every schema."
			orientation="horizontal"
			options={schemaOptions}
			bind:value={schemas}
		/>
		<div>
			<!-- The action reads `enabled` from the body. Without this the
			     switch posts nothing and every webhook is created disabled. -->
			<input type="hidden" name="enabled" value={enabled ? 'true' : 'false'} />
			<Toggle id="webhook-enabled" label="Enabled" bind:checked={enabled} />
		</div>

		<fieldset class="flex flex-col gap-4 border-t border-line pt-4">
			<legend class="text-sm font-medium text-fg">Delivery options</legend>
			<p class="text-xs text-muted">Leave a field empty to use the default. An option this instance does not enable is refused when you save.</p>
			<Textarea
				id="webhook-template"
				name="payload_template"
				label="Payload template"
				rows={3}
				mono
				bind:value={template}
				hint="A Go template for the body. Empty sends the standard event JSON."
			/>
			<Input id="webhook-jsonpath" name="jsonpath_filter" label="JSONPath filter" mono bind:value={jsonpath} placeholder="$.data.status" />
			<Textarea
				id="webhook-filters"
				name="field_filters"
				label="Field filters"
				rows={2}
				mono
				bind:value={filters}
				placeholder="status=published"
				hint="One field=value per line. Only matching events are sent."
				error={formErrors.field_filters}
			/>
			<div class="grid gap-4 sm:grid-cols-2">
				<Input id="webhook-retries" name="max_retries" label="Retries" inputmode="numeric" bind:value={maxRetries} placeholder="Default" />
				<Input id="webhook-delay" name="retry_delay_seconds" label="Retry delay (seconds)" inputmode="numeric" bind:value={retryDelay} placeholder="Default" />
			</div>
		</fieldset>
	</form>
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (open = false)}>Cancel</Button>
		<Button variant="primary" type="submit" form="webhook-form" loading={submit.pending}>{editing ? 'Save' : 'Create'}</Button>
	{/snippet}
</Drawer>

<form method="POST" action="?/delete" use:enhance bind:this={deleteForm} class="hidden">
	<input type="hidden" name="id" value={deleteId} />
</form>

<!-- A row's history is a read on that row, so it opens over the list the way
     its edit does, and the queue does the same. -->
<Drawer bind:open={showDeliveries} title="Delivery history for {deliveriesWebhookName}" size="xl">
	{#snippet children()}
			{#if deliveryItems.length === 0}
				<EmptyState
					title="No deliveries recorded yet"
					description="Every attempt this webhook makes is listed here."
				>
					{#snippet iconSnippet()}<History size={ICON.lg} />{/snippet}
				</EmptyState>
			{:else}
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
						{#each deliveryItems as d (d.id)}
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
											<input type="hidden" name="id" value={deliveriesWebhookId} />
											<input type="hidden" name="delivery_id" value={d.id} />
											<Button
												variant="ghost"
												size="sm"
												type="submit"
												title="Retry this delivery"
												aria-label="Retry the delivery attempted at {formatDateTime(
													d.attempted_at
												)}"
											>
												<RotateCcw class="h-3.5 w-3.5" />
											</Button>
										</form>
									{:else if retryResults[d.id]}
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
			<Button variant="secondary" type="button" onclick={() => (showDeliveries = false)}>
				Close
			</Button>
		{/snippet}
</Drawer>

<Drawer bind:open={showDeadLetters} title="Dead letter queue" size="xl">
	{#snippet children()}
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
									{#if deadLetterResults[dl.id]}
										<span class="text-xs text-muted">{deadLetterResults[dl.id]}</span>
									{:else if dl.status === 'pending'}
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
