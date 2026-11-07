<script lang="ts">
	import { tick } from 'svelte';
	import { enhance } from '$app/forms';
	import { navigating } from '$app/state';
	import {
		Alert,
		Banner,
		Button,
		Card,
		CheckboxGroup,
		MultiSelect,
		NumberInput,
		PageShell,
		SegmentedControl,
		Skeleton,
		Toggle,
		confirm,
	} from '@lyeve-labs/ui-kit';
	import BuilderConnectionTabs from '$lib/components/BuilderConnectionTabs.svelte';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import NotEnabled from '$lib/components/NotEnabled.svelte';
	import { tracked } from '$lib/forms.svelte';
	import { SAID, type Settings } from '$lib/api/connected-editors';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const PATH = '/admin/settings/connected-editors/builder';

	/** Every key the setting action answers with, each optional. */
	interface Answer {
		saved?: { field: string; settings: Settings };
		settingError?: { field: string; message: string };
	}

	const answer = $derived((form ?? {}) as Answer);

	/** The browser's own word on whether it is online. Every save waits while it is not. */
	let online = $state(true);
	$effect(() => {
		online = navigator.onLine;
		const up = () => (online = true);
		const down = () => (online = false);
		window.addEventListener('online', up);
		window.addEventListener('offline', down);
		return () => {
			window.removeEventListener('online', up);
			window.removeEventListener('offline', down);
		};
	});

	const loading = $derived(navigating.to?.url.pathname === PATH);

	const settings = $derived(data.settings?.ok ? data.settings.value : null);
	const settingError = $derived(answer.settingError ?? null);
	const savedField = $derived(answer.saved?.field ?? '');

	let allowedOn = $derived(settings?.allowed ?? false);
	let lifetimeSetting = $derived(String(settings?.lifetime_days ?? 90));
	let writes = $derived(settings?.writes_per_minute ?? 120);
	// A schema allowed earlier and deleted since is not offered, so the next save drops it.
	let shown = $derived((settings?.show_schemas ?? []).filter((s) => data.schemas.includes(s)));

	let allowedForm = $state<HTMLFormElement | null>(null);
	const saveAllowed = tracked(() => {});
	const saveLimits = tracked(() => {});

	// The switch applies at once, so it sits in a card of its own. Everything
	// else in the settings saves together under one Save.
	async function allowedChanged(on: boolean) {
		if (!on && settings?.allowed) {
			const ok = await confirm('Turn off the builder?', 'Connected browsers stop saving immediately.', {
				confirmLabel: 'Turn off',
			});
			if (!ok) {
				allowedOn = true;
				return;
			}
		}
		await tick();
		allowedForm?.requestSubmit();
	}

	function errorOn(field: string): string | undefined {
		return settingError?.field === field ? settingError.message : undefined;
	}

	const schemaOptions = $derived(data.schemas.map((s) => ({ value: s, label: s })));
</script>

<PageShell
	title="Builder connections"
	documentTitle="Builder settings - Builder connections"
	description="Choose whether this tenant can connect the builder, for how long, and what it may read and write."
	width="wide"
	back={{ href: '/admin/settings', label: 'Settings' }}
>
	{#if !online}
		<Banner tone="warn">You're offline. Changes on this page wait until you reconnect.</Banner>
	{/if}

	<BuilderConnectionTabs active="builder" owner />

	{#if data.gate.state === 'withheld'}
		<NotEnabled level={2} title="Builder connections" description={SAID.withheld} />
	{:else if data.gate.state !== 'ok'}
		<GateNotice level={2} gate={data.gate} title="Builder connections" absent="Builder connections are not included in this build." />
	{:else if data.settings && !data.settings.ok}
		<GateNotice level={2} gate={data.settings.gate} title="Builder settings" absent="Builder settings need a newer version of the builder plugin." />
	{:else if loading}
		<Card>
			<div class="flex flex-col gap-3" data-testid="settings-loading">
				{#each [1, 2, 3, 4] as row (row)}
					<Skeleton height="2rem" />
				{/each}
			</div>
		</Card>
	{:else if settings}
		<Card>
			<form bind:this={allowedForm} method="POST" action="?/setting" use:enhance={saveAllowed.enhance} class="flex flex-col gap-4">
				<input type="hidden" name="field" value="allowed" />
				<input type="hidden" name="allowed" value={allowedOn ? 'on' : 'off'} />
				{#if !settings.allowed}
					<Alert tone="warn">The builder is off. Connected browsers cannot save.</Alert>
				{/if}
				{#if savedField === 'allowed'}
					<Alert tone="success" autoDismiss>Setting saved.</Alert>
				{/if}
				<Toggle
					label="Enabled"
					hint="Lets connected browsers save pages. Changes apply immediately."
					bind:checked={allowedOn}
					disabled={saveAllowed.pending || !online}
					onchange={allowedChanged}
				/>
				{#if errorOn('allowed')}
					<Alert tone="danger">{errorOn('allowed')}</Alert>
				{/if}
			</form>
		</Card>

		<Card>
			<form method="POST" action="?/setting" use:enhance={saveLimits.enhance} class="flex flex-col items-start gap-6">
				<input type="hidden" name="field" value="limits" />
				{#if savedField === 'limits'}
					<Alert tone="success" autoDismiss>Settings saved.</Alert>
				{/if}
				{#if answer.saved?.settings.note}
					<Alert tone="brand">{answer.saved.settings.note}</Alert>
				{/if}

				<SegmentedControl
					label="Valid for"
					name="lifetime_days"
					bind:value={lifetimeSetting}
					options={[
						{ value: '30', label: '30 days' },
						{ value: '90', label: '90 days' },
						{ value: '180', label: '180 days' },
					]}
					hint="Applies to connections approved from now on."
					error={errorOn('lifetime_days')}
				/>

				{#if data.schemasGate}
					<GateNotice gate={data.schemasGate} title="Schemas" absent="Schemas are not included in this build." />
				{:else if data.schemas.length === 0}
					<p class="text-sm text-muted">Create a schema to show its entries on pages.</p>
				{:else}
					<!-- Only a form that offered the schemas saves them, so a schema list that failed to load clears nothing. -->
					<input type="hidden" name="schemas_offered" value="1" />
					{#if data.schemas.length <= 12}
						<CheckboxGroup
							label="Open to the builder"
							name="show_schemas"
							bind:value={shown}
							options={schemaOptions}
							orientation="horizontal"
							hint="Pages can show entries from the schemas you choose."
							error={errorOn('show_schemas')}
						/>
					{:else}
						<MultiSelect
							id="show-schemas"
							label="Open to the builder"
							bind:value={shown}
							options={schemaOptions}
							searchable
							hint="Pages can show entries from the schemas you choose."
							error={errorOn('show_schemas')}
						/>
						{#each shown as name (name)}
							<input type="hidden" name="show_schemas" value={name} />
						{/each}
					{/if}
				{/if}

				<NumberInput
					id="writes-per-minute"
					name="writes_per_minute"
					label="Writes a minute for each connection"
					bind:value={writes}
					min={1}
					max={settings.max_writes_per_minute}
					hint="When a connection reaches this limit, the builder waits and saves again."
					error={errorOn('writes_per_minute')}
				/>

				{#if settingError && !['allowed', 'lifetime_days', 'show_schemas', 'writes_per_minute'].includes(settingError.field)}
					<Alert tone="danger">{settingError.message}</Alert>
				{/if}

				<Button variant="primary" type="submit" loading={saveLimits.pending} disabled={!online}>Save</Button>
			</form>
		</Card>
	{/if}
</PageShell>
