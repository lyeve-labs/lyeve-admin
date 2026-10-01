<script lang="ts">
	import PageTitle from '$lib/components/PageTitle.svelte';
	import { enhance } from '$app/forms';
	import { Alert, Button, PasswordInput } from '@lyeve-labs/ui-kit';
	import { ArrowLeft } from '@lucide/svelte';
	import AuthShell from '$lib/components/AuthShell.svelte';
	import { submitter } from '$lib/forms.svelte';
	import { ICON } from '$lib/icon';
	import type { ActionData, PageData } from './$types';

	let { form, data }: { form: ActionData; data: PageData } = $props();

	const save = submitter();

	const done = $derived(form && 'done' in form && form.done === true);
	const expired = $derived(form && 'expired' in form && form.expired === true);
</script>

<PageTitle title="Choose a new password" />

<AuthShell title={done ? 'Password changed' : 'Choose a new password'}>
	{#if done}
		<div class="space-y-5">
			<Alert tone="success">Your password has been changed. Sign in with the new one.</Alert>
			<Button href="/login" variant="primary" full>Sign in</Button>
		</div>
	{:else if !data.token || expired}
		<div class="space-y-5">
			<Alert tone="danger">{form?.error ?? 'This reset link is incomplete. Open the link from the email again, or request a new one.'}</Alert>
			<Button href="/forgot-password" variant="secondary" full>Request a new link</Button>
			<Button href="/login" variant="ghost" size="sm" full>
				<ArrowLeft size={ICON.sm} aria-hidden="true" />
				Back to sign in
			</Button>
		</div>
	{:else}
		<form method="POST" use:enhance={save.enhance} class="space-y-5">
			{#if form?.error}
				<Alert tone="danger">{form.error}</Alert>
			{/if}

			<input type="hidden" name="token" value={data.token} />

			<PasswordInput
				id="password"
				name="password"
				label="New password"
				hint="At least {data.minLength} characters."
				autocomplete="new-password"
				required
			/>

			<PasswordInput
				id="confirm"
				name="confirm"
				label="Confirm new password"
				autocomplete="new-password"
				required
			/>

			<Button type="submit" variant="primary" full loading={save.pending}>Save</Button>
		</form>
	{/if}
</AuthShell>
