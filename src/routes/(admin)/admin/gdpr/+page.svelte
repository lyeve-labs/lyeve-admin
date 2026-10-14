<script lang="ts">
	import { Alert, Button, Card, Input, PageShell, SectionHeading } from '@lyeve-labs/ui-kit';
	import type { ActionData } from './$types';
	import { enhance } from '$app/forms';
	import { Download, Trash2, FileJson } from '@lucide/svelte';
	import type { DsarExportResult, DsarEraseResult } from '@lyeve-labs/client-rest';
	import { ICON } from '$lib/icon';

	let { form }: { form: ActionData } = $props();

	let exportSubject = $state('');
	let eraseSubject = $state('');
	let eraseConfirm = $state('');
	let exporting = $state(false);
	let erasing = $state(false);

	const canErase = $derived(
		eraseSubject.trim().length > 0 && eraseConfirm.trim() === eraseSubject.trim()
	);

	const confirmError = $derived(
		eraseConfirm.length > 0 && !canErase ? 'Does not match the subject above' : undefined
	);

	const exportResult = $derived(
		form?.action === 'export' && form.ok ? (form.result as DsarExportResult) : null
	);
	/**
	 * The engine also names the legal holds that stopped an erasure. The
	 * client's type does not carry them yet, so the page reads them through
	 * its own.
	 */
	interface HeldErasure extends DsarEraseResult {
		holds?: { id: string; reason?: string }[];
	}

	const eraseResult = $derived(
		form?.action === 'erase' && form.ok ? (form.result as HeldErasure) : null
	);
	// An active hold stops the whole erasure before anything is erased. The
	// answer then carries no rows and no errors, which alone reads as done.
	const eraseHolds = $derived(eraseResult?.holds ?? []);
	// A plugin that failed to erase still holds the subject's data. The rows
	// erased elsewhere do not make the request complete.
	const eraseFailures = $derived(eraseResult?.errors ?? []);

	const exportJson = $derived(exportResult ? JSON.stringify(exportResult, null, 2) : '');
	const exportHref = $derived(
		exportResult ? `data:application/json;charset=utf-8,${encodeURIComponent(exportJson)}` : ''
	);
	const exportFilename = $derived(
		exportResult
			? `dsar-export-${exportResult.identifier.replace(/[^a-zA-Z0-9._@-]/g, '_')}.json`
			: ''
	);
</script>

<PageShell
	title="Privacy requests"
	description="Every piece of personal data held for one subject, exported or erased. GDPR calls this a data subject request. Super admins only."
	width="wide"
	back={{ href: '/admin/settings', label: 'Settings' }}
>
	<section class="flex flex-col gap-4">
		<SectionHeading level={2}>Export subject data</SectionHeading>

		<Card>
			<div class="flex flex-col gap-4">
				<p class="text-sm text-muted">
					Fans the identifier out to every plugin and returns the merged personal data as JSON.
				</p>
				<form
					method="POST"
					action="?/export"
					use:enhance={() => {
						exporting = true;
						return async ({ update }) => {
							await update({ reset: false });
							exporting = false;
						};
					}}
					class="flex flex-col gap-4"
				>
					<Input
						id="export-subject"
						label="Subject (email or ID)"
						name="subject"
						bind:value={exportSubject}
						required
						autocomplete="off"
						placeholder="jane@example.com"
					/>
					{#if form?.action === 'export' && form.error}
						<Alert tone="danger">{form.error}</Alert>
					{/if}
					<div class="flex justify-end">
						<Button type="submit" variant="primary" loading={exporting}>
							<Download size={ICON.sm} /> Export
						</Button>
					</div>
				</form>
			</div>
		</Card>

		{#if exportResult}
			<Card pad="none">
				{#snippet header()}
					<div class="flex flex-wrap items-center justify-between gap-3">
						<span class="text-xs text-muted">
							{exportResult.summary.total_records}
							{exportResult.summary.total_records === 1 ? 'record' : 'records'} from
							{exportResult.summary.plugins_with_data} of {exportResult.summary.plugins_queried}
							{exportResult.summary.plugins_queried === 1 ? 'plugin' : 'plugins'}
						</span>
						<!-- The payload is already in the page, so the link carries it as a
						     data URI. Button refuses that scheme, which is why this one
						     control is a plain anchor. -->
						<!-- ui-consistency: allow raw-button - a download link carrying a data URI, which Button refuses -->
						<a
							href={exportHref}
							download={exportFilename}
							class="inline-flex items-center gap-2 rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-brand-light"
						>
							<FileJson size={ICON.sm} /> Download JSON
						</a>
					</div>
				{/snippet}
				{#if exportResult.errors.length > 0}
					<div class="border-b border-line px-5 py-2 text-xs text-warn">
						{exportResult.errors.length === 1 ? 'An exporter failed' : `${exportResult.errors.length} exporters failed`}: {exportResult.errors
							.map((e) => e.error)
							.join('; ')}
					</div>
				{/if}
				<pre class="max-h-96 overflow-auto p-4 text-xs text-fg">{exportJson}</pre>
			</Card>
		{/if}
	</section>

	<section class="flex flex-col gap-4">
		<SectionHeading level={2}>Erase subject data</SectionHeading>

		<Card>
			<div class="flex flex-col gap-4">
				<Alert tone="danger" title="This cannot be undone">
					Permanently erases or anonymizes all personal data for the subject across every plugin.
				</Alert>
				<form
					method="POST"
					action="?/erase"
					use:enhance={() => {
						erasing = true;
						return async ({ result, update }) => {
							await update({ reset: false });
							if (result.type === 'success') {
								eraseSubject = '';
								eraseConfirm = '';
							}
							erasing = false;
						};
					}}
					class="flex flex-col gap-4"
				>
					<Input
						id="erase-subject"
						label="Subject (email or ID)"
						name="subject"
						bind:value={eraseSubject}
						required
						autocomplete="off"
						placeholder="jane@example.com"
					/>
					<Input
						id="erase-confirm"
						label="Type the subject again to confirm"
						name="confirm"
						bind:value={eraseConfirm}
						autocomplete="off"
						placeholder="Re-type to confirm erasure"
						error={confirmError}
						hint="Erasure stays disabled until this matches"
					/>
					{#if form?.action === 'erase' && form.error}
						<Alert tone="danger">{form.error}</Alert>
					{/if}
					<div class="flex justify-end">
						<Button
							type="submit"
							variant="danger"
							disabled={!canErase}
							loading={erasing}
						>
							<Trash2 size={ICON.sm} /> Erase permanently
						</Button>
					</div>
				</form>
			</div>
		</Card>

		{#if eraseResult && eraseHolds.length > 0}
			<!-- Stays until dismissed: nothing was erased, and the reader has to act on it. -->
			<Alert tone="warn" title="Erasure held">
				<p>
					Nothing was erased for <span class="font-mono text-xs">{eraseResult.identifier}</span>, because
					{eraseHolds.length === 1 ? 'a legal hold covers' : 'legal holds cover'} this subject. Release
					{eraseHolds.length === 1 ? 'it' : 'them'} under audit retention, then run the erasure again.
				</p>
				<ul class="mt-2 list-disc pl-5 text-xs">
					{#each eraseHolds as hold (hold.id)}
						<li>{hold.reason || hold.id}</li>
					{/each}
				</ul>
			</Alert>
		{:else if eraseResult && eraseFailures.length > 0}
			<!-- Stays until dismissed: data is still held, and the reader has to act on it. -->
			<Alert tone="warn" title="Erasure incomplete">
				<p>
					Erased <span class="font-medium">{eraseResult.total_rows}</span>
					{eraseResult.total_rows === 1 ? 'row' : 'rows'} for
					<span class="font-mono text-xs">{eraseResult.identifier}</span>, but part of the instance could
					not erase, so data for this subject is still held there. The engine's log names the part that
					failed. Run the erasure again once the cause is fixed.
				</p>
				<ul class="mt-2 list-disc pl-5 text-xs">
					{#each eraseFailures as failure, i (i)}
						<li>{failure}</li>
					{/each}
				</ul>
			</Alert>
		{:else if eraseResult}
			<Alert tone="success" title="Erasure complete" autoDismiss>
				<p>
					Erased <span class="font-medium">{eraseResult.total_rows}</span>
					{eraseResult.total_rows === 1 ? 'row' : 'rows'} for
					<span class="font-mono text-xs">{eraseResult.identifier}</span>.
				</p>
			</Alert>
		{/if}
	</section>
</PageShell>
