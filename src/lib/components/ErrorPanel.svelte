<script lang="ts">
	import { Badge, Button, EmptyState } from '@lyeve-labs/ui-kit';
	import { AlertTriangle, ArrowLeft, FileQuestion, Home, Lock, RefreshCw, ServerOff, ShieldOff } from '@lucide/svelte';
	import { page } from '$app/state';
	import { ICON } from '$lib/icon';
	import { OUTAGE } from '$lib/outage';

	/**
	 * What the reader is told when a page cannot be served.
	 *
	 * Both `+error.svelte` files render this one component, so the same 404
	 * leads with the same action wherever it is served. It is built from the
	 * kit's own empty state and badge rather than from a hand-rolled copy of
	 * each, so the worst page a reader
	 * meets is the one that looks most like the rest of the product.
	 */
	interface Props {
		status: number;
		/** The engine's own words, when it sent any. */
		message?: string;
		/** Where "home" is: the console for a signed-in reader, the site otherwise. */
		homeHref: string;
		homeLabel: string;
	}

	let { status, message = '', homeHref, homeLabel }: Props = $props();

	// A 503 is an engine or a database that did not answer. That is temporary
	// and the session survives it, so it gets its own face rather than the one
	// for a request that failed.
	const variant = $derived(
		status === 401 || status === 403 ? 'auth' : status === 404 ? 'missing' : status === 503 ? 'outage' : 'server',
	);

	// Derived, not a literal: a plain object is built once and would keep the
	// status the page first rendered with.
	const Icon = $derived(
		variant === 'auth'
			? status === 403
				? ShieldOff
				: Lock
			: variant === 'missing'
				? FileQuestion
				: variant === 'outage'
					? ServerOff
					: AlertTriangle,
	);
	const tones = { auth: 'warn', missing: 'neutral', outage: 'warn', server: 'danger' } as const;

	const title = $derived(
		variant === 'auth'
			? status === 401
				? 'Not signed in'
				: 'Access denied'
			: variant === 'missing'
				? 'Not found'
				: variant === 'outage'
					? OUTAGE.title
					: 'Something went wrong',
	);

	/**
	 * No offer of support, because there is nothing here to reach it by. A
	 * sentence that tells a reader to contact somebody, and then does not say
	 * who, spends their patience and gives nothing back.
	 */
	const hint = $derived(
		variant === 'auth'
			? status === 401
				? 'The session has expired. Sign in again to carry on.'
				: 'This account cannot open that page.'
			: variant === 'missing'
				? message || 'That page or record does not exist.'
				: variant === 'outage'
					? OUTAGE.body
					: 'The request did not complete. Trying again is worth one attempt. The details below are what the server said.',
	);

	// The address that failed, query included. A link rather than a click
	// handler, so the retry works before the page hydrates.
	const retryHref = $derived(page.url.pathname + page.url.search);
</script>

<EmptyState {title} description={hint}>
	{#snippet iconSnippet()}
		<Icon size={ICON.lg} />
	{/snippet}

	{#snippet children()}
		<div class="flex flex-col items-center gap-3">
			<Badge tone={tones[variant]}>{status}</Badge>
			{#if variant === 'server'}
				<!-- Shut by default: a stack trace is the first thing on screen only
				     for the reader who went looking for it. -->
				<details class="w-full text-left">
					<summary class="cursor-pointer text-xs text-faint transition-colors hover:text-muted">
						What the server said
					</summary>
					<pre
						class="border-line bg-surface-2 text-muted mt-2 max-h-32 overflow-auto rounded-lg border p-3 text-xs">{message ||
							'Nothing beyond the status.'}</pre>
				</details>
			{/if}
		</div>
	{/snippet}

	{#snippet action()}
		<div class="flex items-center gap-3">
			{#if variant === 'auth'}
				<!-- There is a right answer here, so one control carries it. Three
				     equal-weight secondaries offer a choice the reader does not have. -->
				<Button href="/login">
					<Lock size={ICON.sm} aria-hidden="true" /> Sign in
				</Button>
				<Button variant="secondary" href={homeHref}>
					<Home size={ICON.sm} aria-hidden="true" /> {homeLabel}
				</Button>
			{:else if variant === 'outage'}
				<!-- The one control is the retry. Every other page needs the same
				     engine, and signing in again cannot help while it is silent. -->
				<Button href={retryHref}>
					<RefreshCw size={ICON.sm} aria-hidden="true" /> {OUTAGE.action}
				</Button>
			{:else}
				<Button href={homeHref}>
					<Home size={ICON.sm} aria-hidden="true" /> {homeLabel}
				</Button>
				<Button variant="secondary" onclick={() => history.back()}>
					<ArrowLeft size={ICON.sm} aria-hidden="true" /> Go back
				</Button>
			{/if}
		</div>
	{/snippet}
</EmptyState>
