<script lang="ts">
	import PageTitle from '$lib/components/PageTitle.svelte';
	import { Alert, Badge, Card, DescriptionList, PageShell, SectionHeading, Toggle } from '@lyeve-labs/ui-kit';
	import { enhance } from '$app/forms';
	import type { ActionData, PageData } from './$types';
	import AiSection from '$lib/components/ai/AiSection.svelte';
	import SettingRow from '$lib/components/SettingRow.svelte';
	import { AI_OK } from '$lib/api/ai';
	import { formatDateTime } from '$lib/format';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// The switch as the action last left it, or as the layout read it.
	const settings = $derived(form?.scope === 'switch' && 'settings' in form ? form.settings : data.aiSettings);
	const switchError = $derived(form?.scope === 'switch' && form.error ? form.error : null);
	const configResult = $derived(form?.scope === 'config' ? { key: form.key, error: form.error, success: 'success' in form } : null);

	let enabledForm = $state<HTMLFormElement | null>(null);
	let transcriptsForm = $state<HTMLFormElement | null>(null);

	const retention = $derived(data.instance.find((s) => s.key === 'ai_transcript_retention'));
	const instanceTranscripts = $derived(data.instance.find((s) => s.key === 'ai_transcripts_enabled'));
</script>

<PageTitle title="AI settings" />

<PageShell title="AI settings" description="The switch for this tenant, transcript storage and how long a transcript is kept." width="wide">
	<AiSection tab="settings" gate={AI_OK} layoutGate={data.aiLayoutGate} noun="settings">
		{#if settings}
			<section class="flex flex-col gap-4">
				<SectionHeading level={2}>This tenant</SectionHeading>
				<Card>
					<div class="flex flex-col gap-6">
						<form bind:this={enabledForm} method="POST" action="?/save" use:enhance class="flex flex-col gap-3" data-testid="ai-enabled-form">
							<input type="hidden" name="enabled" value={settings.enabled ? 'false' : 'true'} />
							<Toggle
								id="ai-enabled"
								label="AI for this tenant"
								hint="Off: every route answers 404, the flow nodes refuse with the reason, the editor assistant is gone and a plugin calling through the host is told AI is disabled. Nothing is sent anywhere."
								checked={settings.enabled}
								onchange={() => enabledForm?.requestSubmit()}
							/>
							<div class="rounded-md border border-line bg-surface-2 p-4 text-sm leading-relaxed text-muted" data-testid="what-never-leaves">
								<p class="mb-2 font-medium text-fg">What never leaves this instance</p>
								<p>
									The only bytes that leave are the request to the endpoint you configured: the system prompt, the
									conversation, and for an image operation the picture. They go to the vendor behind that endpoint,
									under the agreement you hold with that vendor, and to nobody else. This plugin ships no default
									provider, no hosted proxy and no telemetry of prompts. LyEve Labs never sees your prompts, your
									responses, your keys, your transcripts, the vendor's replies, which vendor you use, or whether the
									feature is in use. A local endpoint on your own network sends
									nothing to a third party at all. Transcripts are stored in your database,
									under the retention window below, and are covered by tenant deletion and by data-subject export and
									erasure. Nothing is anonymized, because nothing needs to be: the data stays where it was written.
									Read your vendor's data processing agreement and training-use terms. They are yours to sign, and
									the plugin cannot change what they say.
								</p>
							</div>
						</form>

						<form bind:this={transcriptsForm} method="POST" action="?/save" use:enhance class="flex flex-col gap-3" data-testid="ai-transcripts-form">
							<input type="hidden" name="transcripts_enabled" value={settings.transcripts_enabled ? 'false' : 'true'} />
							<Toggle
								id="ai-transcripts"
								label="Store transcripts"
								hint="Off means nothing is written: no messages, no recap, and a call reports no transcript id. Existing transcripts stay until retention removes them."
								checked={settings.transcripts_enabled}
								disabled={!settings.enabled}
								onchange={() => transcriptsForm?.requestSubmit()}
							/>
						</form>

						{#if switchError}
							<Alert tone="danger">{switchError}</Alert>
						{/if}
						<p class="text-xs text-faint">
							{#if settings.updated_at && settings.updated_by}
								Last changed {formatDateTime(settings.updated_at)} by {settings.updated_by}.
							{:else}
								Never changed. A tenant with no row is on.
							{/if}
						</p>
					</div>
				</Card>
			</section>

			<section class="flex flex-col gap-4">
				<SectionHeading level={2}>Retention</SectionHeading>
				<Card>
					<div class="flex flex-col gap-4">
						<p class="text-sm text-muted">
							Retention is set per instance, not per tenant. An hourly sweeper removes transcripts older than the window
							on every tenant. The minimum is 1h and the default is 720h, thirty days.
						</p>
						{#if retention && instanceTranscripts}
							<DescriptionList
								items={[
									{ term: 'Retention', value: `${retention.value} (${retention.source})` },
									{ term: 'Instance transcript switch', value: `${instanceTranscripts.value} (${instanceTranscripts.source})` },
								]}
							/>
						{/if}
						{#if data.isSuperAdmin && retention?.editable}
							<SettingRow
								id="retention"
								name="ai_transcript_retention"
								label="Retention"
								value={retention.value}
								action="?/config"
								saved="Saved. The next sweep applies it."
								result={configResult}
							/>
						{:else if data.isSuperAdmin && data.instanceReadable}
							<p class="text-xs text-faint">
								<Badge tone="neutral" size="sm">{retention?.source ?? 'default'}</Badge>
								Set outside the admin. Change it where it is set.
							</p>
						{:else if !data.isSuperAdmin}
							<p class="text-xs text-faint">A super admin sets the window in the instance configuration.</p>
						{:else}
							<p class="text-xs text-faint">The instance configuration could not be read. The values shown are the defaults.</p>
						{/if}
					</div>
				</Card>
			</section>
		{/if}
	</AiSection>
</PageShell>
