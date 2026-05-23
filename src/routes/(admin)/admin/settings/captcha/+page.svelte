<script lang="ts">
	import PageTitle from '$lib/components/PageTitle.svelte';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import RefusalNotice from '$lib/components/RefusalNotice.svelte';
	import { formRefusal } from '$lib/api/refusal';
	import {
		Alert,
		Badge,
		Button,
		Card,
		Input,
		PageShell,
		PasswordInput,
		SectionHeading,
		SegmentedControl,
		confirm as confirmDialog,
		toast,
	} from '@lyeve-labs/ui-kit';
	import { enhance } from '$app/forms';
	import { tracked } from '$lib/forms.svelte';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { CAPTCHA_PROVIDERS, providerLabel, type CaptchaProvider } from '$lib/api/captcha-settings';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const refusal = $derived(formRefusal(form));
	const formError = $derived((form as { error?: string } | null)?.error ?? '');
	const settings = $derived(data.settings);
	const tenant = $derived(settings?.tenant ?? null);

	let provider = $state<CaptchaProvider>('turnstile');
	let siteKey = $state('');
	let secret = $state('');
	let scoreFloor = $state('');

	// The form starts from what is stored, and follows a save or a clear.
	$effect(() => {
		provider = tenant?.provider ?? 'turnstile';
		siteKey = tenant?.site_key ?? '';
		scoreFloor = tenant?.score_floor == null ? '' : String(tenant.score_floor);
		secret = '';
	});

	const save = tracked(() => async ({ result, update }) => {
		await update({ reset: false });
		if (result.type === 'success') toast.success('Saved the captcha settings');
	});

	const clear: SubmitFunction = async ({ cancel }) => {
		const confirmed = await confirmDialog(
			'Clear the tenant captcha settings?',
			"This tenant's pages and flows go back to the install's captcha, and the stored secret is deleted.",
			{ confirmLabel: 'Clear' },
		);
		if (!confirmed) {
			cancel();
			return;
		}
		return async ({ result, update }) => {
			await update();
			if (result.type === 'success') toast.success('Cleared the captcha settings');
		};
	};
</script>

<PageTitle title="Captcha" />

<PageShell
	title="Captcha"
	description="The captcha this tenant's own pages and flows check, with keys of its own."
	width="wide"
	back={{ href: '/admin/settings', label: 'Settings' }}
>
	{#if data.gate.state !== 'ok' || !settings}
		<GateNotice
			gate={data.gate}
			title="Captcha"
			absent="The captcha plugin is not part of this build, so no form is challenged."
		/>
	{:else}
		<Alert tone="brand" title="The admin login always uses the install's captcha">
			These settings apply to this tenant's own pages and flows. Signing in to this console is challenged with the
			install's settings whatever is saved here, so a wrong key here cannot lock an admin out.
		</Alert>

		{#if refusal}
			<RefusalNotice {refusal} />
		{:else if formError}
			<Alert tone="danger">{formError}</Alert>
		{/if}

		<section class="flex flex-col gap-4" aria-label="What is checked now">
			<SectionHeading level={2}>What is checked now</SectionHeading>
			<Card pad="md">
				<div class="flex flex-col gap-2 text-sm">
					<p class="text-fg" data-testid="captcha-source">
						{#if settings.source === 'tenant' && tenant}
							This tenant's flows check {providerLabel(tenant.provider)} with its own keys.
						{:else if settings.instance.enabled}
							This tenant's flows check the install's {providerLabel(settings.instance.provider)}.
						{:else}
							No captcha is checked: neither this tenant nor the install has one set.
						{/if}
					</p>
					<p class="text-muted">
						The install's captcha:
						{settings.instance.enabled ? providerLabel(settings.instance.provider) : 'not set'}.
						<Badge tone={settings.source === 'tenant' ? 'brand' : 'neutral'}>
							{settings.source === 'tenant' ? 'Tenant settings' : 'Install settings'}
						</Badge>
					</p>
				</div>
			</Card>
		</section>

		<section class="flex flex-col gap-4" aria-label="Tenant settings">
			<SectionHeading level={2}>Tenant settings</SectionHeading>
			{#if !settings.licensed}
				<p class="text-sm text-muted">
					Saving or changing tenant captcha settings needs a license this install does not hold. Settings already
					saved keep applying, and clearing them is always allowed.
				</p>
			{/if}
			<Card pad="md">
				<form id="captcha-form" method="POST" action="?/save" use:enhance={save.enhance} class="flex flex-col gap-4">
					<SegmentedControl
						label="Provider"
						name="provider"
						bind:value={provider}
						options={CAPTCHA_PROVIDERS.map((p) => ({ value: p.value, label: p.label }))}
					/>
					<Input
						id="captcha-site-key"
						name="site_key"
						label="Site key"
						hint="The public key the widget loads with."
						bind:value={siteKey}
						required
					/>
					<PasswordInput
						id="captcha-secret"
						name="secret_key"
						label="Secret key"
						autocomplete="off"
						hint={tenant?.has_secret
							? 'A secret is stored and is never shown. Leave this empty to keep it, or enter a new one to replace it.'
							: 'Used to verify each answer with the provider. It is stored sealed and never shown again.'}
						bind:value={secret}
						required={!tenant?.has_secret}
					/>
					{#if provider === 'recaptcha'}
						<Input
							id="captcha-score-floor"
							name="score_floor"
							label="Score floor"
							hint="reCAPTCHA v3 scores each check from 0 to 1. A check below this fails. Empty uses the provider's default."
							placeholder="0.5"
							bind:value={scoreFloor}
						/>
					{/if}
					<div class="flex flex-wrap items-center gap-2">
						<Button variant="primary" type="submit" loading={save.pending}>Save</Button>
					</div>
				</form>
				{#if tenant}
					<form method="POST" action="?/clear" class="mt-4 border-t border-line pt-4" use:enhance={clear}>
						<Button variant="secondary" size="sm" type="submit">Clear tenant settings</Button>
					</form>
				{/if}
			</Card>
		</section>
	{/if}
</PageShell>
