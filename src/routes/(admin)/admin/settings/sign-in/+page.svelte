<script lang="ts">
	import GateNotice from '$lib/components/GateNotice.svelte';
	import FormErrors from '$lib/components/FormErrors.svelte';
	import { formRefusal } from '$lib/api/refusal';
	import { Button, Card, NumberInput, PageShell, SectionHeading, toast } from '@lyeve-labs/ui-kit';
	import { enhance } from '$app/forms';
	import { tracked } from '$lib/forms.svelte';
	import { PROVIDER_WINDOW_DEFAULT_DAYS, PROVIDER_WINDOW_MAX_DAYS } from '$lib/api/provider-window';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const refusal = $derived(formRefusal(form));
	const formError = $derived((form as { error?: string } | null)?.error ?? '');

	let days = $state(PROVIDER_WINDOW_DEFAULT_DAYS);

	// The field starts from what is stored, and follows a save.
	$effect(() => {
		days = data.window?.days ?? PROVIDER_WINDOW_DEFAULT_DAYS;
	});

	const save = tracked(() => async ({ result, update }) => {
		await update({ reset: false });
		if (result.type === 'success') toast.success('Saved the sign-in window');
	});
</script>

<PageShell
	title="Sign-in"
	description="How accounts your identity provider created may sign in when they do not go through it."
	width="wide"
	back={{ href: '/admin/settings', label: 'Settings' }}
>
	{#if data.gate.state !== 'ok' || !data.window}
		<GateNotice
			level={2}
			gate={data.gate}
			title="Sign-in"
			absent="This engine does not serve the sign-in window. It arrives with an engine upgrade."
		/>
	{:else}
		<FormErrors message={formError} refused={refusal} />

		<section class="flex flex-col gap-4" aria-label="Without the identity provider">
			<SectionHeading level={2}>Without the identity provider</SectionHeading>
			<p class="text-sm text-muted">
				An account your identity provider created can also sign in with a password, reset its password or ask for an
				email link. It may do that only within this many days of its last sign-in through the provider. Removing
				someone in your provider closes those ways in once the window passes. Provisioning through SCIM closes them at
				once.
			</p>
			<Card pad="md">
				<form method="POST" action="?/save" use:enhance={save.enhance} class="flex flex-col gap-4">
					<NumberInput
						id="provider-window-days"
						name="days"
						label="Days since the last provider sign-in"
						hint={`0 allows sign-in through the provider only. The default is ${PROVIDER_WINDOW_DEFAULT_DAYS} days, and the most is ${PROVIDER_WINDOW_MAX_DAYS}.`}
						min={0}
						max={PROVIDER_WINDOW_MAX_DAYS}
						step={1}
						required
						bind:value={days}
					/>
					<div class="flex flex-wrap items-center gap-2">
						<Button variant="primary" type="submit" loading={save.pending}>Save</Button>
					</div>
				</form>
			</Card>
		</section>
	{/if}
</PageShell>
