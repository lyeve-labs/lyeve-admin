<script lang="ts">
	import PageTitle from '$lib/components/PageTitle.svelte';
	import RefusalNotice from '$lib/components/RefusalNotice.svelte';
	import { formRefusal } from '$lib/api/refusal';
	import {
		Alert,
		Badge,
		Button,
		Card,
		Input,
		PageShell,
		SectionHeading,
		Select,
		Tag,
	} from '@lyeve-labs/ui-kit';
	import { enhance } from '$app/forms';
	import { ArrowDown, ArrowUp, Plus, X } from '@lucide/svelte';
	import type { ActionData, PageData } from './$types';
	import { ICON } from '$lib/icon';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	const pageRefusal = $derived(formRefusal(form));

	// The saved answer wins over the loaded one: the action returns without a
	// redirect, so `data` still carries what the page opened with.
	let loaded = $derived(form && 'locales' in form && form.locales ? form.locales : data.locales);

	// svelte-ignore state_referenced_locally
	let defaultLocale = $state(loaded.default_locale);
	// svelte-ignore state_referenced_locally
	let enabled = $state<string[]>([...loaded.enabled_locales]);
	// svelte-ignore state_referenced_locally
	let chain = $state<string[]>([...loaded.fallback_chain]);
	let newLocale = $state('');
	let chainPick = $state<string | null>('');
	let submitting = $state(false);

	let addable = $derived(
		enabled
			.filter((l) => l !== defaultLocale && !chain.includes(l))
			.map((l) => ({ value: l, label: l })),
	);

	function addLocale() {
		const code = newLocale.trim();
		if (!code || enabled.includes(code)) return;
		enabled = [...enabled, code];
		newLocale = '';
	}

	function removeLocale(code: string) {
		enabled = enabled.filter((l) => l !== code);
		chain = chain.filter((l) => l !== code);
	}

	function appendToChain() {
		const pick = chainPick ?? '';
		if (!pick || chain.includes(pick)) return;
		chain = [...chain, pick];
		chainPick = '';
	}

	function move(index: number, by: -1 | 1) {
		const to = index + by;
		if (to < 0 || to >= chain.length) return;
		const next = [...chain];
		[next[index], next[to]] = [next[to], next[index]];
		chain = next;
	}

	let enabledJSON = $derived(JSON.stringify(enabled));
	let chainJSON = $derived(JSON.stringify(chain));
</script>

<PageTitle title="Locales" />

<PageShell
	title="Locales"
	description="The languages this tenant keeps content in, and the order a missing translation falls back through."
	width="wide"
	back={{ href: '/admin/settings', label: 'Settings' }}
>
	{#snippet actions()}
		<Badge tone="violet" size="sm">Beta</Badge>
	{/snippet}

	{#if data.unavailable}
		<Alert tone="warn" title="The localization plugin did not answer">
			The engine lists the plugin, but its routes are not responding. Locales cannot be read or
			written until it is.
		</Alert>
	{:else}
		{#if pageRefusal}
			<RefusalNotice refusal={pageRefusal} />
		{:else if form?.error}
			<Alert tone="danger">{form.error}</Alert>
		{:else if form?.saved}
			<Alert tone="success" autoDismiss>Locales saved.</Alert>
		{/if}

		<form
			method="POST"
			action="?/save"
			use:enhance={() => {
				submitting = true;
				return async ({ update }) => {
					submitting = false;
					await update({ reset: false });
				};
			}}
			class="flex flex-col gap-5"
		>
			<input type="hidden" name="enabled_locales" value={enabledJSON} />
			<input type="hidden" name="fallback_chain" value={chainJSON} />

			<Card>
				<div class="flex flex-col gap-4">
					<SectionHeading level={3}>Default locale</SectionHeading>
					<Input
						id="default-locale"
						name="default_locale"
						label="Default locale"
						hint="The language the source fields are written in. A reader who asks for nothing else gets this."
						placeholder="en"
						bind:value={defaultLocale}
						autocomplete="off"
						mono
					/>
				</div>
			</Card>

			<Card>
				<div class="flex flex-col gap-4">
					<SectionHeading level={3}>Enabled locales</SectionHeading>
					<p class="text-sm text-muted">
						Each one is a tab in every entry's Translations panel. Language tags such as
						<span class="font-mono">fr</span> or <span class="font-mono">pt-BR</span>.
					</p>
					<div class="flex flex-wrap gap-2" role="list" aria-label="Enabled locales">
						{#each enabled as code (code)}
							<div role="listitem">
								{#if code === defaultLocale}
									<Tag label="{code} (default)" tone="brand" />
								{:else}
									<Tag label={code} removable onremove={() => removeLocale(code)} />
								{/if}
							</div>
						{:else}
							<span class="text-sm text-faint">No locale enabled yet.</span>
						{/each}
					</div>
					<div class="flex items-end gap-2">
						<Input
							id="new-locale"
							label="Add locale"
							placeholder="fr"
							bind:value={newLocale}
							autocomplete="off"
							onkeydown={(e) => {
								if (e.key === 'Enter') {
									e.preventDefault();
									addLocale();
								}
							}}
							mono
						/>
						<Button type="button" variant="secondary" size="md" onclick={addLocale}>
							<Plus size={ICON.sm} /> Add locale
						</Button>
					</div>
				</div>
			</Card>

			<Card>
				<div class="flex flex-col gap-4">
					<SectionHeading level={3}>Fallback chain</SectionHeading>
					<p class="text-sm text-muted">
						When a translation is missing, the reader gets the first locale in this order that has
						one, and the source fields after that.
					</p>
					<ol class="flex flex-col gap-2" aria-label="Fallback chain">
						{#each chain as code, i (code)}
							<li class="flex items-center gap-2 rounded-md border border-line bg-surface-2/40 px-3 py-2">
								<span class="w-6 text-xs text-faint">{i + 1}.</span>
								<span class="flex-1 font-mono text-sm text-fg">{code}</span>
								<Button
									type="button"
									variant="ghost"
									size="sm"
									aria-label="Move {code} up"
									disabled={i === 0}
									onclick={() => move(i, -1)}
								>
									<ArrowUp size={ICON.sm} />
								</Button>
								<Button
									type="button"
									variant="ghost"
									size="sm"
									aria-label="Move {code} down"
									disabled={i === chain.length - 1}
									onclick={() => move(i, 1)}
								>
									<ArrowDown size={ICON.sm} />
								</Button>
								<Button
									type="button"
									variant="ghost"
									size="sm"
									aria-label="Take {code} out of the chain"
									onclick={() => (chain = chain.filter((l) => l !== code))}
								>
									<X size={ICON.sm} />
								</Button>
							</li>
						{:else}
							<li class="text-sm text-faint">
								Empty. A missing translation falls straight back to the source.
							</li>
						{/each}
					</ol>
					<div class="flex items-end gap-2">
						<div class="flex-1">
							<Select
								id="chain-pick"
								label="Append a locale"
								placeholder="Pick a locale"
								options={addable}
								bind:value={chainPick}
								disabled={addable.length === 0}
							/>
						</div>
						<Button
							type="button"
							variant="secondary"
							size="md"
							disabled={!chainPick}
							onclick={appendToChain}
						>
							<Plus size={ICON.sm} /> Append
						</Button>
					</div>
				</div>
			</Card>

			<div class="flex justify-end">
				<Button type="submit" loading={submitting}>Save</Button>
			</div>
		</form>
	{/if}
</PageShell>
