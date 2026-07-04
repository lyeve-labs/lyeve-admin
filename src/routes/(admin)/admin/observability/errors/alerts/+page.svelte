<script lang="ts">
	import PageTitle from '$lib/components/PageTitle.svelte';
	import {
		Alert,
		Button,
		Card,
		CopyField,
		Modal,
		NumberInput,
		PageShell,
		SectionHeading,
		SegmentedControl,
	} from '@lyeve-labs/ui-kit';
	import { enhance } from '$app/forms';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import FormErrors from '$lib/components/FormErrors.svelte';
	import NotEnabled from '$lib/components/NotEnabled.svelte';
	import AlertChannelFields from '$lib/components/AlertChannelFields.svelte';
	import { submitter } from '$lib/forms.svelte';
	import { formRefusal } from '$lib/api/refusal';
	import { SETTINGS_CHANNEL_PREFIX } from '$lib/api/error-tracking';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const submit = submitter();
	const settings = $derived(data.settings);
	const formError = $derived(form && 'error' in form && form.error ? String(form.error) : undefined);
	const refused = $derived(formRefusal(form));

	const storedCustom = $derived(
		!!settings && (settings.spike_min_count !== null || settings.spike_z_score !== null),
	);
	// A custom threshold is the plugin's paid setting. One already stored stays
	// editable after a lapse, so it can be put back to the default.
	const thresholdLocked = $derived(!!settings && !settings.licensed && !storedCustom);

	// svelte-ignore state_referenced_locally
	let mode = $state<'default' | 'custom'>(storedCustom ? 'custom' : 'default');
	// svelte-ignore state_referenced_locally
	let minCount = $state(settings?.spike_min_count ?? settings?.defaults.spike_min_count ?? 10);
	// svelte-ignore state_referenced_locally
	let zScore = $state(settings?.spike_z_score ?? settings?.defaults.spike_z_score ?? 2.5);

	const MODES = [
		{ value: 'default', label: 'Default' },
		{ value: 'custom', label: 'Custom' },
	];

	// The webhook's signing secret arrives once, in the answer to the write
	// that set the URL.
	let reveal = $state('');
	$effect(() => {
		if (form && 'signingSecret' in form && typeof form.signingSecret === 'string' && form.signingSecret) {
			reveal = form.signingSecret;
		}
	});
</script>

<PageTitle title="Spike alerts" />

<PageShell
	title="Spike alerts"
	description="Where this tenant hears about a sudden rise in errors, and what counts as one."
	width="wide"
	back={{ href: '/admin/observability/errors', label: 'Errors' }}
>
	{#if data.gate.state !== 'ok' || !settings}
		<GateNotice
			gate={data.gate}
			title="Spike alerts"
			absent="The error tracking plugin is not part of this build, so there are no spike alerts to set."
		/>
	{:else}
		<form method="POST" action="?/save" id="spike-form" use:enhance={submit.enhance} class="flex flex-col gap-6">
			<FormErrors message={formError} {refused} />
			{#if form && 'saved' in form && form.saved}
				<Alert tone="success" autoDismiss>Spike alerts saved.</Alert>
			{/if}

			<Card>
				{#snippet header()}
					<SectionHeading level={3}>Where alerts go</SectionHeading>
				{/snippet}
				<div class="flex flex-col gap-4">
					<p class="text-sm text-muted">
						A spike is logged on every install. Each channel set here hears about it too, at most once
						every fifteen minutes. Email is on every install.
					</p>
					<AlertChannelFields
						prefix={SETTINGS_CHANNEL_PREFIX}
						idPrefix="spike"
						value={settings.channels}
						licensed={settings.licensed}
					/>
				</div>
			</Card>

			<Card>
				{#snippet header()}
					<SectionHeading level={3}>What counts as a spike</SectionHeading>
				{/snippet}
				<div class="flex flex-col gap-4">
					<p class="text-sm text-muted">
						The default flags a window of at least {settings.defaults.spike_min_count} errors whose
						z-score against the windows before it passes {settings.defaults.spike_z_score}.
					</p>
					{#if thresholdLocked}
						<div class="flex flex-col gap-1.5" data-testid="threshold-locked">
							<NotEnabled compact title="A custom threshold" />
							<p class="text-xs text-muted">This tenant uses the default threshold.</p>
						</div>
						<input type="hidden" name="threshold_mode" value="default" />
					{:else}
						<SegmentedControl label="Threshold" name="threshold_mode" bind:value={mode} options={MODES} />
						{#if mode === 'custom'}
							<div class="grid gap-4 sm:grid-cols-2">
								<NumberInput
									id="spike-min-count"
									name="spike_min_count"
									label="Minimum errors in a window"
									hint="A window with fewer errors is never a spike."
									min={1}
									step={1}
									bind:value={minCount}
								/>
								<NumberInput
									id="spike-z-score"
									name="spike_z_score"
									label="Z-score"
									hint="How far above the windows before it, from 0.5 to 20."
									min={0.5}
									max={20}
									step={0.1}
									bind:value={zScore}
								/>
							</div>
						{/if}
					{/if}
				</div>
			</Card>

			<div class="flex justify-end">
				<Button variant="primary" type="submit" loading={submit.pending}>Save</Button>
			</div>
		</form>

		{#if data.windowDays}
			<p class="text-xs text-muted" data-testid="event-window">
				The event lists on this instance read the last {data.windowDays} days. Older events are kept.
			</p>
		{/if}
	{/if}
</PageShell>

{#if reveal}
	<Modal open title="Webhook signing secret" onclose={() => (reveal = '')}>
		<div class="flex flex-col gap-3">
			<p class="text-sm text-fg">
				Every spike alert sent to the webhook is signed with this secret. Copy it to the receiver now. It is
				not shown again.
			</p>
			<CopyField value={reveal} label="Signing secret" mono secret />
		</div>
		{#snippet footer()}
			<Button variant="secondary" onclick={() => (reveal = '')}>Close</Button>
		{/snippet}
	</Modal>
{/if}
