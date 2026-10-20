<script lang="ts">
	import { Alert, Button, CopyButton, Modal, SegmentedControl } from '@lyeve-labs/ui-kit';

	export type ExportFormat = 'json' | 'yaml';

	interface Props {
		/** The flow's name, for the title. */
		name: string;
		/** The flow's slug, which names the downloaded file. */
		slug: string;
		/** Reads the saved draft in one format. The page owns the request, so the panel never calls the engine. */
		load: (format: ExportFormat) => Promise<string>;
	}

	let { name, slug, load }: Props = $props();

	// The panel stays mounted while it is closed, so the format the reader
	// picked last is the one the next opening loads.
	let open = $state(false);
	let format = $state<ExportFormat>('json');
	let text = $state('');
	let error = $state('');
	let loading = $state(false);

	async function loadFormat(next: ExportFormat) {
		format = next;
		error = '';
		// The text of the other format is not this one's, so it goes while the
		// new one loads.
		text = '';
		loading = true;
		try {
			const body = await load(next);
			text = next === 'json' ? JSON.stringify(JSON.parse(body), null, 2) : body;
		} catch {
			error = 'The export could not be loaded. Save the draft and try again.';
		} finally {
			loading = false;
		}
	}

	/** Opens the panel and reads the export in the format picked last. */
	export function show() {
		text = '';
		open = true;
		void loadFormat(format);
	}
</script>

{#if open}
	<Modal open title="Export {name}" onclose={() => (open = false)}>
		{#snippet children()}
			<div class="flex flex-col gap-3">
				<div class="flex items-center justify-between gap-2">
					<SegmentedControl
						label="Format"
						labelHidden
						size="sm"
						value={format}
						options={[
							{ value: 'json', label: 'JSON' },
							{ value: 'yaml', label: 'YAML' },
						]}
						onchange={(v) => void loadFormat(v)}
					/>
					<CopyButton value={text} label="Copy" />
				</div>
				<p class="text-xs text-muted">The saved draft, secrets stripped. Datasources are named, not carried.</p>
				{#if error}
					<Alert tone="danger">
						{#snippet children()}{error}{/snippet}
					</Alert>
				{/if}
				{#if loading}
					<p class="text-sm text-muted" aria-live="polite">Loading the export.</p>
				{:else if text}
					<pre class="max-h-96 overflow-auto rounded-md border border-line bg-surface-2 p-3 font-mono text-xs text-fg">{text}</pre>
				{/if}
				{#if text}
					<a
						class="text-xs text-brand underline"
						download="{slug || 'flow'}.{format}"
						href={`data:${format === 'json' ? 'application/json' : 'application/yaml'};charset=utf-8,${encodeURIComponent(text)}`}
					>
						Download {format.toUpperCase()}
					</a>
				{/if}
			</div>
		{/snippet}
		{#snippet footer()}
			<Button variant="secondary" onclick={() => (open = false)}>Close</Button>
		{/snippet}
	</Modal>
{/if}
