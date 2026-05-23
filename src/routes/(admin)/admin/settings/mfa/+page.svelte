<script lang="ts">
	import PageTitle from '$lib/components/PageTitle.svelte';
	import { formRefusal } from '$lib/api/refusal';
	import { Alert, Button, Card, CopyField, Input, PageShell, Skeleton } from '@lyeve-labs/ui-kit';
	import { enhance } from '$app/forms';
	import { Shield, Copy, Check } from '@lucide/svelte';
	import FormErrors from '$lib/components/FormErrors.svelte';
	import type { ActionData, PageData } from './$types';
	import { copyText } from '$lib/clipboard';
	import { tracked } from '$lib/forms.svelte';
	import { ICON } from '$lib/icon';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// The QR image, the generator and the placeholder all have to agree on one
	// edge length, so it is stated once.
	const QR_SIZE = 180;

	const setup = tracked(() => {});
	const verify = tracked(() => async ({ update }) => update({ reset: false }));
	const disable = tracked(() => {});

	// The step is what the last action answered. A fresh load is the start.
	const step = $derived(form?.step ?? 'idle');
	const uri = $derived(form && 'uri' in form ? (form.uri ?? '') : '');
	const secret = $derived(form && 'secret' in form ? (form.secret ?? '') : '');
	const backupCodes = $derived(form && 'backupCodes' in form ? (form.backupCodes ?? []) : []);
	const actionErrorText = $derived(form && 'error' in form ? form.error : undefined);

	let code = $state('');
	let disableCode = $state('');
	let clipboardError = $state('');
	let copiedCodes = $state(false);
	let qrDataUrl = $state('');

	// Only the browser draws the code, so the generator is loaded here and
	// never on the server. qrcode is CommonJS, which the dev server's SSR
	// runner cannot evaluate, and a static import would put the whole page
	// behind it.
	$effect(() => {
		if (!uri) {
			qrDataUrl = '';
			return;
		}
		let current = true;
		import('qrcode')
			.then(({ default: QRCode }) => QRCode.toDataURL(uri, { width: QR_SIZE, margin: 1 }))
			.then((url) => {
				if (current) qrDataUrl = url;
			});
		return () => {
			current = false;
		};
	});

	const mfaEnabled = $derived(data.mfaEnabled);

	async function copyBackupCodes() {
		if (!(await copyText(backupCodes.join('\n')))) {
			clipboardError = 'Could not reach the clipboard. Write the codes down before leaving this page.';
			return;
		}
		copiedCodes = true;
		setTimeout(() => (copiedCodes = false), 2000);
	}
</script>

<PageTitle title="Two-factor authentication" />

<PageShell
	title="Two-factor authentication"
	description={mfaEnabled ? 'Enabled on this account.' : 'Not enabled on this account.'}
	width="wide"
	back={{ href: '/admin/settings', label: 'Settings' }}
>
	<FormErrors message={actionErrorText || clipboardError || undefined} refused={formRefusal(form)} />

	{#if step === 'done'}
		<Alert tone="success" title="Two-factor authentication is on">
			Save these backup codes somewhere safe. They are not shown again.
		</Alert>
		<Card>
			<div class="flex flex-col gap-4">
				<div class="grid grid-cols-2 gap-2">
					{#each backupCodes as backupCode (backupCode)}
						<code class="bg-surface-2 border border-line rounded-lg px-3 py-1 text-xs font-mono text-fg">
							{backupCode}
						</code>
					{/each}
				</div>
				<div class="flex justify-end gap-3">
					<Button variant="secondary" onclick={copyBackupCodes}>
						{#if copiedCodes}
							<Check size={ICON.sm} class="text-success" aria-hidden="true" />
						{:else}
							<Copy size={ICON.sm} aria-hidden="true" />
						{/if}
						Copy all codes
					</Button>
					<Button variant="primary" href="/admin/settings/mfa">Done</Button>
				</div>
			</div>
		</Card>
	{:else if step === 'confirming'}
		<Card>
			<form method="POST" action="?/verify" use:enhance={verify.enhance} class="flex flex-col gap-5">
				<input type="hidden" name="uri" value={uri} />
				<input type="hidden" name="secret" value={secret} />
				<p class="text-fg text-sm">
					Scan this QR code in an authenticator app, or enter the secret by hand.
				</p>
				<!-- The code carries the same secret as the field below it, and that
				     field is the accessible equivalent, so the image is decorative. -->
				<div class="flex justify-center">
					{#if qrDataUrl}
						<img
							src={qrDataUrl}
							alt=""
							data-testid="totp-qr"
							class="rounded-lg border border-line"
							width={QR_SIZE}
							height={QR_SIZE}
						/>
					{:else}
						<Skeleton
							width="{QR_SIZE}px"
							height="{QR_SIZE}px"
							rounded="rounded-lg"
							class="border border-line"
						/>
					{/if}
				</div>
				<CopyField id="totp-secret" label="Manual entry secret" value={secret} copyLabel="Copy the manual entry secret" />
				<Input
					id="totp-code"
					name="code"
					label="The 6-digit code from the app"
					required
					bind:value={code}
					placeholder="123456"
					autocomplete="one-time-code"
					inputmode="numeric"
					maxlength={6}
				/>
				<div class="flex justify-end">
					<Button type="submit" variant="primary" disabled={code.length < 6} loading={verify.pending}>
						Verify and turn on
					</Button>
				</div>
			</form>
		</Card>
	{:else if mfaEnabled}
		<Alert tone="success" title="Two-factor authentication is on">
			Signing in to this account takes a TOTP code.
		</Alert>
		<Card>
			<form method="POST" action="?/disable" use:enhance={disable.enhance} class="flex flex-col gap-4">
				<Input
					id="dis-code"
					name="code"
					label="Code"
					hint="A current TOTP code, or a backup code."
					bind:value={disableCode}
					autocomplete="one-time-code"
					inputmode="numeric"
				/>
				<div class="flex justify-end">
					<Button type="submit" variant="danger" disabled={disableCode.trim().length === 0} loading={disable.pending}>
						Turn off
					</Button>
				</div>
			</form>
		</Card>
	{:else}
		<Card>
			<form method="POST" action="?/setup" use:enhance={setup.enhance} class="flex flex-col gap-4">
				<p class="text-fg text-sm">Two-factor authentication is off for this account.</p>
				<div class="flex justify-end">
					<Button type="submit" variant="primary" loading={setup.pending}>
						<Shield size={ICON.sm} aria-hidden="true" />
						Turn on two-factor authentication
					</Button>
				</div>
			</form>
		</Card>
	{/if}
</PageShell>
