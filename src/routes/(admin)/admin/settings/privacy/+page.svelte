<script lang="ts">
	import { Alert, Button, Card, PageShell, RadioGroup, SectionHeading } from '@lyeve-labs/ui-kit';
	import { enhance } from '$app/forms';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import FormErrors from '$lib/components/FormErrors.svelte';
	import NotRunning from '$lib/components/NotRunning.svelte';
	import { PLUGIN } from '$lib/plugin-names';
	import { tracked } from '$lib/forms.svelte';
	import { NO_TENANT, type FormErasureMode } from '$lib/api/privacy';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const ERASURE_OPTIONS: { value: FormErasureMode; label: string; description: string }[] = [
		{
			value: 'auto',
			label: 'Decide for each submission',
			description:
				"Delete a submission when the person's address is the only one in it. When it also holds someone else's address, clear only the person's own values. This is the default.",
		},
		{
			value: 'soft',
			label: "Always clear the person's values",
			description: "Keep every submission and remove only what belongs to the person. No submission is deleted.",
		},
		{
			value: 'hard',
			label: 'Always delete the submission',
			description:
				"Delete every submission that holds the person's address, along with anything other people entered in it.",
		},
	];

	// The choice starts from what is stored and follows a save.
	let mode = $state<FormErasureMode>('auto');
	$effect(() => {
		if (data.formErasure?.ok) mode = data.formErasure.value.mode;
	});

	/** The result of one form on this page, so each card shows only its own. */
	function outcome(action: string): { saved?: boolean; error?: string } | null {
		return form && form.action === action ? (form as { saved?: boolean; error?: string }) : null;
	}
	const erasureResult = $derived(outcome('erasure'));

	const saveErasure = tracked(() => async ({ update }) => {
		await update({ reset: false });
	});

	const nothingShown = $derived(!data.noTenant && data.formErasure === null);
</script>

<PageShell
	title="Privacy"
	description="What happens to a person's data in this tenant when they ask for it to be erased."
	width="wide"
	back={{ href: '/admin/settings', label: 'Settings' }}
>
	{#if data.noTenant}
		<!-- No retry: trying again names no tenant either. -->
		<Alert tone="warn">{NO_TENANT}</Alert>
	{/if}

	{#if nothingShown}
		<Alert tone="brand">None of these settings apply to this instance as it runs now, so there is nothing to change here.</Alert>
	{/if}

	{#if data.formErasure}
		<section class="flex flex-col gap-4" aria-label="Form submissions on erasure">
			<SectionHeading level={2}>Form submissions on erasure</SectionHeading>
			{#if 'stopped' in data.formErasure}
				<!-- The page answers admins and super admins only, who may read the plugin list. -->
				<NotRunning
					title="Form submissions on erasure"
					plugin={PLUGIN.schema}
					reason={data.formErasure.stopped}
					operator
				/>
			{:else if !data.formErasure.ok}
				<GateNotice
					gate={data.formErasure.gate}
					title="Form submissions on erasure"
					absent="This instance does not keep form submissions."
				/>
			{:else}
				<Card pad="md">
					<form method="POST" action="?/erasure" use:enhance={saveErasure.enhance} class="flex flex-col gap-4">
						<RadioGroup
							name="mode"
							label="When a person's data is erased, their form submissions are"
							hint="A form submission can name more than one person. This decides how much of it an erasure removes."
							options={ERASURE_OPTIONS}
							bind:value={mode}
						/>
						{#if erasureResult?.error}
							<FormErrors message={erasureResult.error} />
						{:else if erasureResult?.saved}
							<Alert tone="success" autoDismiss>Saved. The next erasure in this tenant follows this choice.</Alert>
						{/if}
						<div class="flex justify-end">
							<Button variant="primary" type="submit" loading={saveErasure.pending}>Save</Button>
						</div>
					</form>
				</Card>
			{/if}
		</section>
	{/if}
</PageShell>
