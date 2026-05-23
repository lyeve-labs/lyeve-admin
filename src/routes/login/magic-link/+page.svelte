<script lang="ts">
	import PageTitle from '$lib/components/PageTitle.svelte';
	import { enhance } from '$app/forms';
	import { Alert, Button, Input } from '@lyeve-labs/ui-kit';
	import { ArrowLeft } from '@lucide/svelte';
	import AuthShell from '$lib/components/AuthShell.svelte';
	import { submitter } from '$lib/forms.svelte';
	import { ICON } from '$lib/icon';
	import type { ActionData } from './$types';

	let { form }: { form: ActionData } = $props();

	const send = submitter();
</script>

<PageTitle title="Email a sign-in link" />

<AuthShell title="Sign in with an email link" description="We will email you a link that signs you in.">
	{#if form && 'sent' in form && form.sent}
		<div class="space-y-5">
			<Alert tone="success">
				If an account exists for {form.email}, a sign-in link is on its way. It works once and expires
				in a few minutes.
			</Alert>
			<Button href="/login" variant="ghost" size="sm" full>
				<ArrowLeft size={ICON.sm} aria-hidden="true" />
				Back to sign in
			</Button>
		</div>
	{:else}
		<form method="POST" use:enhance={send.enhance} class="space-y-5">
			{#if form?.error}
				<Alert tone="danger">{form.error}</Alert>
			{/if}

			<Input
				id="email"
				name="email"
				type="email"
				label="Email"
				placeholder="you@example.com"
				autocomplete="email"
				value={form?.email ?? ''}
				required
				autofocus
			/>

			<Button type="submit" variant="primary" full loading={send.pending}>Email me a link</Button>

			<Button href="/login" variant="ghost" size="sm" full>
				<ArrowLeft size={ICON.sm} aria-hidden="true" />
				Back to sign in
			</Button>
		</form>
	{/if}
</AuthShell>
