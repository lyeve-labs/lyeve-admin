<script lang="ts">
	import { Alert, Button, Card, NumberInput, SectionHeading, SegmentedControl, Stat } from '@lyeve-labs/ui-kit';
	import { enhance } from '$app/forms';
	import { LICENSE_PAGE, formRefusal } from '$lib/api/refusal';
	import {
		FACTS,
		MEMORY_MB_MIN,
		MEMORY_PERCENT,
		POOL_CONNECTIONS,
		GC_PERCENT_MIN,
		cpuModeOf,
		formatCpuChoice,
		formatFact,
		formatMemoryChoice,
		formatSetting,
		memoryFields,
		memoryFieldsOf,
		numberOf,
		pinnedText,
		sourceLabel,
		startOnlyText,
		type PresetKey,
		type Recommended,
		type RuntimeSetting,
		type RuntimeSettingsMap,
	} from '$lib/api/runtime-settings';
	import { factText, recommendationText, warningText } from '$lib/api/runtime-words';
	import FormErrors from '$lib/components/FormErrors.svelte';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import { formatCount } from '$lib/format';
	import type { ActionData, PageData } from './$types';

	interface Props {
		/** What the page load read from the runtime settings routes. */
		runtime: PageData['runtime'];
		/** The page's last action answer. The panel shows only its own. */
		form: ActionData;
		/** The latency depth in the address, kept when the recommendations are refined. */
		top: number;
	}

	let { runtime, form, top }: Props = $props();

	const read = $derived(runtime.settings.ok ? runtime.settings.value : null);
	const recs = $derived(runtime.recommendations?.ok ? runtime.recommendations.value : null);
	// The writes need super_admin and a license that lets them through. A form
	// that could only ever be refused is shown disabled with the reason.
	const canEdit = $derived(Boolean(read?.available && read.licensed) && runtime.superAdmin);
	// Only a super admin may make either read. Another role makes neither, and
	// a 403 from either is drawn the same way.
	const forbidden = $derived(
		!runtime.superAdmin ||
			(!runtime.settings.ok && runtime.settings.gate.state === 'forbidden') ||
			(runtime.recommendations?.ok === false && runtime.recommendations.gate.state === 'forbidden'),
	);

	// The fields open on the values in force and are seeded once, so a refresh
	// never overwrites an edit in progress.
	// svelte-ignore state_referenced_locally
	const seedRead = runtime.settings.ok ? runtime.settings.value : null;
	const seed = {
		cpuMode: cpuModeOf(seedRead?.settings.cpu),
		cpuThreads: numberOf(seedRead?.settings.cpu?.value) ?? 1,
		memory: memoryFields(seedRead?.settings.memory),
		gc: numberOf(seedRead?.settings.gc_percent?.value) ?? 100,
		pool: numberOf(seedRead?.settings.database_max_connections?.value) ?? POOL_CONNECTIONS.min,
	};
	let cpuMode = $state(seed.cpuMode);
	let cpuThreads = $state(seed.cpuThreads);
	let memoryMode = $state(seed.memory.mode);
	let memoryPercent = $state(seed.memory.percent);
	let memoryMb = $state(seed.memory.mb);
	let gcPercent = $state(seed.gc);
	let pool = $state(seed.pool);
	let preset = $state<'current' | PresetKey>('current');
	let saving = $state(false);

	// svelte-ignore state_referenced_locally
	let replicas = $state(runtime.inputs.replicas ?? 1);
	// 0 means not given: the load reads only a positive count.
	// svelte-ignore state_referenced_locally
	let databaseCores = $state(runtime.inputs.database_cores ?? 0);

	// Only a field the reader changed is posted, so a value left alone keeps
	// its source instead of becoming a console setting.
	const cpuDirty = $derived(cpuMode !== seed.cpuMode || (cpuMode === 'fixed' && cpuThreads !== seed.cpuThreads));
	const memoryDirty = $derived(
		memoryMode !== seed.memory.mode ||
			(memoryMode === 'ratio' && memoryPercent !== seed.memory.percent) ||
			(memoryMode === 'bytes' && memoryMb !== seed.memory.mb),
	);
	const gcDirty = $derived(gcPercent !== seed.gc);
	const poolDirty = $derived(pool !== seed.pool);

	const hostCores = $derived(read?.facts?.host_cores?.known ? (numberOf(read.facts.host_cores.value) ?? undefined) : undefined);
	const coresFact = $derived(read?.facts?.database_cores);

	const PRESET_LABELS: Record<PresetKey, string> = { one_server: 'One large server', several_replicas: 'Several replicas' };
	const presetOptions = $derived([
		{ value: 'current' as const, label: 'Values in force' },
		...(['one_server', 'several_replicas'] as const)
			.filter((k) => recs?.presets?.[k])
			.map((k) => ({ value: k, label: PRESET_LABELS[k] })),
	]);

	const cpuOptions = [
		{ value: 'automatic' as const, label: 'Automatic' },
		{ value: 'fixed' as const, label: 'Fixed' },
	];
	const memoryOptions = [
		{ value: 'automatic' as const, label: 'Automatic' },
		{ value: 'ratio' as const, label: 'Share of limit' },
		{ value: 'bytes' as const, label: 'Fixed size' },
		{ value: 'none' as const, label: 'None' },
	];

	const pinned = (s: RuntimeSetting | undefined) => Boolean(s?.pinned);

	/** A preset fills the fields it covers and saves nothing. A pinned field keeps its value. */
	function applyPreset(key: 'current' | PresetKey) {
		const s = read?.settings;
		if (key === 'current') {
			cpuMode = seed.cpuMode;
			cpuThreads = seed.cpuThreads;
			memoryMode = seed.memory.mode;
			memoryPercent = seed.memory.percent;
			memoryMb = seed.memory.mb;
			gcPercent = seed.gc;
			pool = seed.pool;
			return;
		}
		const p = recs?.presets?.[key];
		if (!p) return;
		if (p.cpu && !pinned(s?.cpu)) {
			cpuMode = p.cpu.value.mode;
			if (p.cpu.value.mode === 'fixed') cpuThreads = p.cpu.value.threads;
		}
		if (p.memory && !pinned(s?.memory)) {
			const m = memoryFieldsOf(p.memory.value, { mode: memoryMode, percent: memoryPercent, mb: memoryMb });
			memoryMode = m.mode;
			memoryPercent = m.percent;
			memoryMb = m.mb;
		}
		if (p.gc_percent && !pinned(s?.gc_percent)) gcPercent = p.gc_percent.value;
		if (p.database_max_connections && !pinned(s?.database_max_connections)) pool = p.database_max_connections.value;
	}

	function recommendedText(key: 'cpu' | 'memory' | 'gc_percent' | 'database_max_connections'): string {
		const r = recs?.recommended?.[key] as Recommended<unknown> | undefined;
		if (!r) return '';
		let value: string;
		if (key === 'cpu') value = formatCpuChoice(r.value as Parameters<typeof formatCpuChoice>[0]);
		else if (key === 'memory') value = formatMemoryChoice(r.value as Parameters<typeof formatMemoryChoice>[0]);
		else if (key === 'gc_percent') value = `${r.value}%`;
		else value = formatCount(numberOf(r.value));
		return `Recommended: ${value}. ${recommendationText(r)}`;
	}

	const note = $derived(form?.form === 'runtime' ? form : null);
	const POOL_WARNING =
		"The database pool now uses more than a third of your database's connection limit. Lower it if other applications need to connect.";
	const refusal = $derived(formRefusal(note));

	function submit() {
		saving = true;
		return async ({ update }: { update: (opts?: { reset?: boolean }) => Promise<void> }) => {
			saving = false;
			await update({ reset: false });
		};
	}
</script>

{#snippet inForce(key: keyof RuntimeSettingsMap, s: RuntimeSetting | undefined)}
	<Stat size="sm" label="In force" mono value={formatSetting(key, s)} sub={sourceLabel(s) || undefined} />
{/snippet}

{#snippet advice(key: 'cpu' | 'memory' | 'gc_percent' | 'database_max_connections', s: RuntimeSetting | undefined)}
	{@const text = recommendedText(key)}
	{#if text}
		<p class="text-xs text-muted">{text}</p>
	{/if}
	{#if s?.pinned}
		<p class="text-xs text-muted" data-testid="runtime-pinned-{key}">{pinnedText(s.variable, s.source)}</p>
	{/if}
{/snippet}

<!-- How the engine sizes itself for the machine it runs on and the replicas
     beside it, with the values in force and where each came from. Only a
     super admin can see or change them, and changing them
     needs a license that lets the writes through. A form that cannot
     succeed says why. -->
<section class="flex flex-col gap-4" data-testid="runtime-scaling">
	<div class="flex flex-wrap items-center gap-2">
		<SectionHeading level={2}>Runtime and scaling</SectionHeading>
		{#if !forbidden && read?.available && read.replicas?.known && read.replicas.count > 1}
			<span class="text-xs text-faint" data-testid="runtime-replicas">{formatCount(read.replicas.count)} replicas are running.</span>
		{/if}
	</div>

	{#if forbidden}
		<p class="text-sm text-muted" data-testid="runtime-forbidden">Only a super admin can see the runtime settings.</p>
	{:else if !runtime.settings.ok}
		<GateNotice gate={runtime.settings.gate} title="Runtime settings" absent="Runtime settings are not included in this build." />
	{:else if !read?.available}
		<p class="text-sm text-muted" data-testid="runtime-unavailable">Runtime settings are not available on this engine.</p>
	{:else}
		{#if !read.licensed}
			<div class="flex flex-wrap items-center gap-2" data-testid="runtime-license-note">
				<p class="text-xs text-muted">
					Changing these settings needs a license that includes tuning. The values in force stay visible.
				</p>
				<Button variant="ghost" size="sm" href={LICENSE_PAGE}>View the license</Button>
			</div>
		{/if}

		{#if read.revision > 0 && read.replicas?.known && read.replicas.count > 1 && read.replicas.applied < read.replicas.count}
			<Alert tone="brand" announce>Applied on {formatCount(read.replicas.applied)} of {formatCount(read.replicas.count)} replicas.</Alert>
		{/if}

		{#if runtime.recommendations && !runtime.recommendations.ok}
			<GateNotice gate={runtime.recommendations.gate} title="The recommendations" absent="Recommendations are not included in this build." />
		{:else if recs}
			<Card>
				{#snippet header()}
					<SectionHeading level={3}>Recommendations</SectionHeading>
				{/snippet}
				<div class="flex flex-col gap-4" data-testid="runtime-recommendations">
					{#if recs.warnings.length > 0}
						<Alert tone="warn">
							{#each recs.warnings as warning, i (`${warning.code}-${i}`)}
								<p>{warningText(warning)}</p>
							{/each}
						</Alert>
					{/if}
					{#if !read.replicas?.known || (coresFact && !coresFact.known)}
						<!-- The typed values are query parameters, so the recommendations
						     reload through the page load and survive a refresh. -->
						<form method="GET" class="flex flex-col gap-4" data-sveltekit-noscroll data-sveltekit-keepfocus aria-label="Refine the recommendations">
							<input type="hidden" name="top" value={top} />
							{#if !read.replicas?.known}
								<p class="text-sm text-muted" data-testid="runtime-replicas-unknown">
									Recommendations assume one replica. Enter the number of replicas you run if you run more.
								</p>
							{/if}
							<div class="grid gap-4 sm:grid-cols-2">
								{#if !read.replicas?.known}
									<NumberInput id="rt-replicas" name="replicas" label="Replicas" min={1} bind:value={replicas} />
								{/if}
								{#if coresFact && !coresFact.known}
									<NumberInput id="rt-database-cores" name="database_cores" label="Database cores" min={0} hint={factText(coresFact)} bind:value={databaseCores} />
								{/if}
							</div>
							<div>
								<Button type="submit" variant="secondary" size="sm">Recalculate</Button>
							</div>
						</form>
					{/if}
				</div>
			</Card>
		{/if}

		<form method="POST" action="?/runtime" use:enhance={submit} class="flex flex-col gap-4" aria-label="Runtime settings">
			<input type="hidden" name="revision" value={read.revision} />
			{#if recs && presetOptions.length > 1}
				<SegmentedControl
					label="Start from"
					options={presetOptions}
					bind:value={preset}
					onchange={applyPreset}
					disabled={!canEdit}
					hint="A preset fills the fields below. Nothing changes until you save."
				/>
			{/if}

			<div class="grid gap-4 lg:grid-cols-2" data-testid="runtime-settings">
				<Card>
					{#snippet header()}
						<SectionHeading level={3}>CPU threads</SectionHeading>
					{/snippet}
					<div class="flex flex-col gap-4">
						{@render inForce('cpu', read.settings.cpu)}
						<fieldset disabled={!canEdit || !read.settings.cpu || pinned(read.settings.cpu)} class="flex flex-col gap-4" data-testid="runtime-field-cpu">
							<SegmentedControl
								label="CPU threads"
								labelHidden
								name={cpuDirty ? 'cpu_mode' : undefined}
								options={cpuOptions}
								bind:value={cpuMode}
								hint="Automatic follows the CPU limit of the container or machine."
							/>
							{#if cpuMode === 'fixed'}
								<NumberInput
									id="rt-cpu-threads"
									name={cpuDirty ? 'cpu_threads' : undefined}
									label="Threads"
									min={1}
									max={hostCores}
									hint={hostCores ? `1 to ${formatCount(hostCores)}.` : undefined}
									bind:value={cpuThreads}
								/>
							{/if}
						</fieldset>
						{@render advice('cpu', read.settings.cpu)}
					</div>
				</Card>

				<Card>
					{#snippet header()}
						<SectionHeading level={3}>Soft memory limit</SectionHeading>
					{/snippet}
					<div class="flex flex-col gap-4">
						{@render inForce('memory', read.settings.memory)}
						<fieldset disabled={!canEdit || !read.settings.memory || pinned(read.settings.memory)} class="flex flex-col gap-4" data-testid="runtime-field-memory">
							<SegmentedControl
								label="Soft memory limit"
								labelHidden
								name={memoryDirty ? 'memory_mode' : undefined}
								options={memoryOptions}
								bind:value={memoryMode}
								hint="Automatic uses 85% of the memory limit and follows it when it changes."
							/>
							{#if memoryMode === 'ratio'}
								<NumberInput
									id="rt-memory-percent"
									name={memoryDirty ? 'memory_percent' : undefined}
									label="Share of limit (%)"
									min={MEMORY_PERCENT.min}
									max={MEMORY_PERCENT.max}
									hint="{MEMORY_PERCENT.min} to {MEMORY_PERCENT.max} percent of the memory limit."
									bind:value={memoryPercent}
								/>
							{:else if memoryMode === 'bytes'}
								<NumberInput
									id="rt-memory-mb"
									name={memoryDirty ? 'memory_mb' : undefined}
									label="Size (MB)"
									min={MEMORY_MB_MIN}
									hint="At least {MEMORY_MB_MIN} MB."
									bind:value={memoryMb}
								/>
							{/if}
						</fieldset>
						{@render advice('memory', read.settings.memory)}
					</div>
				</Card>

				<Card>
					{#snippet header()}
						<SectionHeading level={3}>GC target</SectionHeading>
					{/snippet}
					<div class="flex flex-col gap-4">
						{@render inForce('gc_percent', read.settings.gc_percent)}
						<fieldset disabled={!canEdit || !read.settings.gc_percent || pinned(read.settings.gc_percent)} class="flex flex-col gap-4" data-testid="runtime-field-gc_percent">
							<NumberInput
								id="rt-gc-percent"
								name={gcDirty ? 'gc_percent' : undefined}
								label="Target (%)"
								min={GC_PERCENT_MIN}
								hint="100 is the default. Enter -1 to turn collection off, which needs a soft memory limit."
								bind:value={gcPercent}
							/>
						</fieldset>
						{@render advice('gc_percent', read.settings.gc_percent)}
					</div>
				</Card>

				<Card>
					{#snippet header()}
						<SectionHeading level={3}>Database pool</SectionHeading>
					{/snippet}
					<div class="flex flex-col gap-4">
						{@render inForce('database_max_connections', read.settings.database_max_connections)}
						<fieldset
							disabled={!canEdit || !read.settings.database_max_connections || pinned(read.settings.database_max_connections)}
							class="flex flex-col gap-4"
							data-testid="runtime-field-database_max_connections"
						>
							<NumberInput
								id="rt-pool"
								name={poolDirty ? 'database_max_connections' : undefined}
								label="Connections per replica"
								min={POOL_CONNECTIONS.min}
								max={POOL_CONNECTIONS.max}
								hint="{POOL_CONNECTIONS.min} to {formatCount(POOL_CONNECTIONS.max)}."
								bind:value={pool}
							/>
						</fieldset>
						{@render advice('database_max_connections', read.settings.database_max_connections)}
					</div>
				</Card>
			</div>

			<div class="flex flex-col gap-3">
				<div>
					<Button type="submit" variant="primary" size="sm" loading={saving} disabled={!canEdit}>Save settings</Button>
				</div>
				<FormErrors message={note?.error} refused={refusal} />
				{#if note?.saved}
					{#if note.stored}
						<Alert tone="success" autoDismiss>Settings saved.</Alert>
					{:else}
						<!-- A warning stays until it is dismissed: the change is in force but will not survive a restart. -->
						<Alert tone="warn" dismissible>Applied. This engine runs without a database, so the change lasts until the engine restarts.</Alert>
					{/if}
					{#if note.poolWarning}
						<!-- The engine's own caution never reaches the page, so the console words it. -->
						<Alert tone="warn" dismissible>{POOL_WARNING}</Alert>
					{/if}
				{/if}
			</div>
		</form>

		<div class="grid gap-4 lg:grid-cols-2">
			<Card>
				{#snippet header()}
					<SectionHeading level={3}>Applied when the engine starts</SectionHeading>
				{/snippet}
				<div class="grid grid-cols-1 gap-4 sm:grid-cols-3" data-testid="runtime-start-only">
					<Stat size="sm" label="Replica database pool" mono value={formatSetting('replica_max_connections', read.settings.replica_max_connections)} sub={startOnlyText(read.settings.replica_max_connections)} />
					<Stat size="sm" label="Backpressure" mono value={formatSetting('backpressure', read.settings.backpressure)} sub={startOnlyText(read.settings.backpressure)} />
					<Stat size="sm" label="Connection pooler" mono value={formatSetting('pooler', read.settings.pooler)} sub={startOnlyText(read.settings.pooler)} />
				</div>
			</Card>

			<Card>
				{#snippet header()}
					<SectionHeading level={3}>Machine and database</SectionHeading>
				{/snippet}
				<div class="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4" data-testid="runtime-facts">
					{#each FACTS.filter((fact) => read.facts?.[fact.key]) as fact (fact.key)}
						{@const f = read.facts[fact.key]}
						<Stat size="sm" label={fact.label} mono value={formatFact(fact.kind, f)} sub={f && !f.known ? factText(f) : undefined} />
					{/each}
				</div>
			</Card>
		</div>
	{/if}
</section>
