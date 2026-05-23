<script lang="ts">
	/*
	 * New import, in three steps: where the file comes from and which content
	 * type it fills, which column fills which field, then a dry run and the
	 * import itself. The calls carry the file, so they go from the browser to
	 * the engine (see postImport in $lib/api/bulk-import). Nothing here writes
	 * until the last button.
	 */
	import {
		Alert,
		Badge,
		Button,
		Drawer,
		FileInput,
		Input,
		RadioGroup,
		SegmentedControl,
		Select,
		Stat,
		StepIndicator,
		Table,
	} from '@lyeve-labs/ui-kit';
	import { Link, Upload } from '@lucide/svelte';
	import RefusalNotice from '$lib/components/RefusalNotice.svelte';
	import TransformField from '$lib/components/imports/TransformField.svelte';
	import { refusalOf, type Refusal } from '$lib/api/refusal';
	import { errorCodeOf } from '$lib/api/limits';
	import {
		IMPORT_FORMATS,
		IMPORT_FORMAT_LABELS,
		MAX_IMPORT_CELLS,
		MAX_IMPORT_COLUMNS,
		emptyTransform,
		fileToBase64,
		formatFromName,
		mappingTargets,
		parseRefusalHint,
		previewImport,
		startImport,
		suggestMapping,
		transformDraft,
		transformFields,
		validateImport,
		type FieldMapping,
		type ImportFormat,
		type ImportJob,
		type ImportMode,
		type ImportPreview,
		type ImportRequest,
		type ImportSchema,
		type MappingTemplate,
		type SourceInput,
		type TransformDraft,
		type ValidateResult,
	} from '$lib/api/bulk-import';
	import { formatCount } from '$lib/format';

	let {
		open = $bindable(false),
		schemas,
		templates = [],
		licensed = null,
		onstarted,
	}: {
		open?: boolean;
		schemas: ImportSchema[];
		/** The tenant's saved mappings, offered on the first step. */
		templates?: MappingTemplate[];
		/** Whether the plugin said this install may name the paid transforms. Null when it did not say. */
		licensed?: boolean | null;
		onstarted: (job: ImportJob) => void;
	} = $props();

	const STEPS = [
		{ label: 'Source', description: 'The file and its content type' },
		{ label: 'Map', description: 'Columns onto fields' },
		{ label: 'Check', description: 'Dry run, then import' },
	];

	let step = $state(0);
	let busy = $state(false);
	let error = $state('');
	let hint = $state('');
	let refusal = $state<Refusal | null>(null);

	// Step 1.
	let kind = $state<'upload' | 'url'>('upload');
	let file = $state<File | null>(null);
	let url = $state('');
	let format = $state<string>('auto');
	let sheet = $state('');
	let contentType = $state<string>('');
	let templateId = $state('');
	/** The file read once, reused by every later call. */
	let encoded = $state('');

	// Step 2.
	let preview = $state<ImportPreview | null>(null);
	let chosen = $state<Record<string, string>>({});
	let transforms = $state<Record<string, TransformDraft>>({});
	let mode = $state<ImportMode>('create');
	let key = $state<string>('');
	/** The mapping as the template filled it, to tell whether the person changed it. */
	let templateMapping = $state('');

	// Step 3.
	let checked = $state<ValidateResult | null>(null);

	const schemaOptions = $derived(schemas.map((s) => ({ value: s.name, label: s.name })));
	const formatOptions = [
		{ value: 'auto', label: 'Read it from the file' },
		...IMPORT_FORMATS.map((f) => ({ value: f, label: IMPORT_FORMAT_LABELS[f] })),
	];
	const templateOptions = $derived([
		{ value: '', label: 'No template: map the columns here' },
		...templates.map((t) => ({ value: t.id, label: t.content_type ? `${t.name} (${t.content_type})` : t.name })),
	]);
	const template = $derived(templates.find((t) => t.id === templateId));
	const isSheet = $derived(
		format === 'xlsx' ||
			(format === 'auto' &&
				(kind === 'upload' ? formatFromName(file?.name ?? '') : formatFromName(url.split('?')[0])) === 'xlsx'),
	);
	const target = $derived(schemas.find((s) => s.name === contentType));
	const targets = $derived(target ? mappingTargets(target.fields) : []);
	const columnOptions = $derived([
		{ value: '', label: 'Not imported' },
		...(preview?.columns ?? []).map((c) => ({ value: c, label: c })),
	]);
	const keyOptions = $derived([
		{ value: '', label: mode === 'upsert' ? 'Choose the field that finds the entry' : 'No key: every row is a new entry' },
		{ value: 'entry.slug', label: 'Entry slug' },
		...targets.filter((t) => !t.value.startsWith('entry.')).map((t) => ({ value: t.value, label: t.value })),
	]);
	const mapped = $derived(Object.values(chosen).filter(Boolean).length);
	const sheets = $derived(preview?.sheets ?? []);
	/** The sheet the preview read: the one named, or the workbook's first. */
	const sheetRead = $derived(sheets.includes(sheet.trim()) ? sheet.trim() : (sheets[0] ?? ''));
	const sheetOptions = $derived(sheets.map((name) => ({ value: name, label: name })));
	const otherSchemas = $derived(
		preview?.export ? Object.entries(preview.schemas).filter(([name]) => name !== contentType) : [],
	);

	function reset() {
		step = 0;
		busy = false;
		error = '';
		hint = '';
		refusal = null;
		kind = 'upload';
		file = null;
		url = '';
		format = 'auto';
		sheet = '';
		contentType = schemas.length === 1 ? schemas[0].name : '';
		templateId = '';
		encoded = '';
		preview = null;
		chosen = {};
		transforms = {};
		mode = 'create';
		key = '';
		templateMapping = '';
		checked = null;
	}

	let wasOpen = false;
	$effect(() => {
		if (open && !wasOpen) reset();
		wasOpen = open;
	});

	// A template names the content type it was written for, so choosing one
	// fills that in rather than asking twice.
	function chooseTemplate(id: string) {
		templateId = id;
		const t = templates.find((x) => x.id === id);
		if (t?.content_type && schemas.some((s) => s.name === t.content_type)) contentType = t.content_type;
	}

	function source(): SourceInput {
		const fmt = format === 'auto' ? undefined : (format as ImportFormat);
		const tab = isSheet && sheet.trim() ? { sheet: sheet.trim() } : {};
		if (kind === 'url') return { source_url: url.trim(), source_format: fmt, ...tab };
		return {
			file_data: encoded,
			source_name: file?.name ?? '',
			source_format: fmt ?? formatFromName(file?.name ?? '') ?? undefined,
			...tab,
		};
	}

	/** The mapped columns with their transforms, or the first problem in words. */
	function mappings(): FieldMapping[] | string {
		const out: FieldMapping[] = [];
		for (const t of targets) {
			const column = chosen[t.value];
			if (!column) continue;
			const fields = transformFields(transforms[t.value] ?? emptyTransform());
			if (typeof fields === 'string') return `${t.label}: ${fields}`;
			out.push({ source_field: column, target_field: t.value, data_type: t.dataType, ...fields });
		}
		return out;
	}

	// The validate route decodes strictly and takes no dry_run, so the flag is
	// left out rather than sent as false. A mapping left as the template wrote
	// it is sent as the template alone: a transform the template carries keeps
	// applying after a license lapses, and one the request names does not.
	function request(own: FieldMapping[]): ImportRequest {
		const asTemplate = !!templateId && JSON.stringify(own) === templateMapping;
		return {
			...source(),
			content_type: contentType,
			field_mappings: asTemplate ? [] : own,
			mode,
			upsert_key: key || undefined,
			...(templateId ? { template_id: templateId } : {}),
		};
	}

	async function run<T>(fn: () => Promise<T>): Promise<T | null> {
		busy = true;
		error = '';
		hint = '';
		refusal = null;
		try {
			return await fn();
		} catch (e) {
			refusal = refusalOf(e);
			if (!refusal) {
				error = e instanceof Error ? e.message : 'The request failed.';
				hint = parseRefusalHint(error, errorCodeOf(e));
			}
			return null;
		} finally {
			busy = false;
		}
	}

	async function readSource() {
		if (!contentType) {
			error = 'Choose the content type the rows become.';
			return;
		}
		if (kind === 'upload' && !file) {
			error = 'Choose a file to import.';
			return;
		}
		if (kind === 'url' && !url.trim()) {
			error = 'Paste the address of the file.';
			return;
		}
		const got = await run(async () => {
			if (kind === 'upload' && file) encoded = await fileToBase64(file);
			return previewImport(fetch, { ...source(), content_type: contentType });
		});
		if (!got) return;
		preview = got;
		chosen = suggestMapping(got.columns, targets);
		transforms = Object.fromEntries(targets.map((t) => [t.value, emptyTransform()]));
		templateMapping = '';
		if (template) {
			// The template's own mapping wins over the guess, column by column.
			for (const m of template.field_mappings) {
				if (!targets.some((t) => t.value === m.target_field)) continue;
				chosen[m.target_field] = got.columns.includes(m.source_field) ? m.source_field : '';
				transforms[m.target_field] = transformDraft(m);
			}
			if (template.mode) mode = template.mode;
			key = template.upsert_key ?? '';
			const own = mappings();
			templateMapping = typeof own === 'string' ? '' : JSON.stringify(own);
		} else if (got.export && chosen['entry.slug']) {
			// An export carries its slug, so the slug is the key that brings the
			// same entries back rather than duplicating them.
			mode = 'upsert';
			key = 'entry.slug';
		}
		checked = null;
		step = 1;
	}

	// Another sheet has other columns, so choosing one reads the workbook
	// again and maps the new columns from the start.
	async function chooseSheet(name: string) {
		if (name === sheetRead) return;
		sheet = name;
		await readSource();
	}

	async function dryRun() {
		if (mapped === 0) {
			error = 'Map at least one column.';
			return;
		}
		if (mode === 'upsert' && !key) {
			error = 'Choose the key field that finds the entry to update.';
			return;
		}
		const own = mappings();
		if (typeof own === 'string') {
			error = own;
			return;
		}
		const got = await run(() => validateImport(fetch, request(own)));
		if (!got) return;
		checked = got;
		step = 2;
	}

	async function importRows() {
		const own = mappings();
		if (typeof own === 'string') {
			error = own;
			return;
		}
		const job = await run(() => startImport(fetch, request(own)));
		if (!job) return;
		open = false;
		onstarted(job);
	}

	const importable = $derived(checked ? checked.valid_rows : 0);
</script>

<Drawer
	bind:open
	title="New import"
	description="Nothing is written until the last step. The dry run reports what would be rejected and why."
>
	<div class="flex flex-col gap-5">
		<StepIndicator steps={STEPS} current={step + 1} />
		{#if refusal}
			<RefusalNotice {refusal} />
		{:else if error}
			<Alert tone="danger">
				<p>{error}</p>
				{#if hint}<p class="mt-1">{hint}</p>{/if}
			</Alert>
		{/if}

		{#if step === 0}
			<SegmentedControl
				label="Source"
				bind:value={kind}
				options={[
					{ value: 'upload', label: 'Upload a file', icon: Upload },
					{ value: 'url', label: 'From a web address', icon: Link },
				]}
			/>
			{#if kind === 'upload'}
				<FileInput
					id="import-file"
					label="File"
					accept=".csv,.json,.ndjson,.jsonl,.yaml,.yml,.xlsx,text/csv,application/json,application/yaml,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
					hint={file
						? `${file.name}, ${formatCount(Math.ceil(file.size / 1024))} KB`
						: 'CSV with a header row, an Excel workbook (XLSX), JSON, NDJSON or YAML, up to 50 MB. A LyEve data export imports as it is.'}
					onchange={(files) => (file = files?.[0] ?? null)}
				/>
			{:else}
				<Input
					id="import-url"
					label="Address"
					placeholder="https://example.com/export.json"
					hint="An http or https link the engine fetches. For another LyEve instance, paste the signed download link of a finished export. Private and internal addresses are refused."
					bind:value={url}
				/>
			{/if}
			<div class="grid gap-4 sm:grid-cols-2">
				<Select
					id="import-schema"
					label="Content type"
					hint="Each row becomes an entry of this type."
					searchable
					bind:value={contentType}
					options={schemaOptions}
				/>
				<Select id="import-format" label="Format" bind:value={format} options={formatOptions} />
			</div>
			{#if isSheet}
				<Input
					id="import-sheet"
					label="Sheet"
					placeholder="Sheet1"
					hint="The worksheet to read, matched exactly. Empty reads the first, and the next step lists every sheet the workbook holds. Its first row is the header."
					bind:value={sheet}
				/>
			{/if}
			<p class="text-xs text-muted">
				A CSV file or a sheet is read up to {formatCount(MAX_IMPORT_COLUMNS)} columns and {formatCount(MAX_IMPORT_CELLS)}
				cells, its header's width times its rows. A wider or larger one is refused before any row is read.
			</p>
			{#if templates.length > 0}
				<Select
					id="import-template"
					label="Mapping template"
					hint="A saved mapping fills in the columns, their transforms, the key and the mode. You can still change them."
					value={templateId}
					onvaluechange={chooseTemplate}
					options={templateOptions}
				/>
			{/if}
		{:else if step === 1 && preview}
			<p class="text-sm text-muted">
				{formatCount(preview.total_rows)} {preview.total_rows === 1 ? 'row' : 'rows'} of {IMPORT_FORMAT_LABELS[preview.source_format] ?? preview.source_format}
				from <span class="font-mono text-xs">{preview.source_name}</span>.
				{#if preview.export}This is a LyEve export: its slug, title and status are mapped to the entry's own.{/if}
				{#if template}Mapped from the template {template.name}.{/if}
			</p>
			{#if sheets.length > 1}
				<Select
					id="import-sheet-read"
					label="Sheet"
					hint={`The workbook holds ${formatCount(sheets.length)} sheets. Choosing another reads it instead, and its columns are mapped again.`}
					searchable={sheets.length > 10}
					value={sheetRead}
					onvaluechange={chooseSheet}
					options={sheetOptions}
				/>
			{/if}
			{#if otherSchemas.length > 0}
				<Alert tone="brand">
					The export also holds {otherSchemas.map(([n, c]) => `${formatCount(c)} ${n}`).join(', ')}. Only its {contentType}
					entries are imported. Import the others into their own content types.
				</Alert>
			{/if}
			{#if preview.errors.length > 0}
				<Alert tone="warn">
					{formatCount(preview.errors.length)} rows could not be read and will be rejected, starting with row
					{preview.errors[0].row_index + 1}: {preview.errors[0].message}
				</Alert>
			{/if}

			{#if preview.rows.length > 0}
				<Table label="First rows of the file">
					<thead>
						<tr>
							{#each preview.columns as c (c)}
								<th scope="col" class="font-mono text-xs">{c}</th>
							{/each}
						</tr>
					</thead>
					<tbody>
						{#each preview.rows.slice(0, 5) as row, i (i)}
							<tr>
								{#each preview.columns as c (c)}
									<td class="max-w-48 truncate text-xs">{row[c] ?? ''}</td>
								{/each}
							</tr>
						{/each}
					</tbody>
				</Table>
			{/if}

			<Table label="Column mapping">
				<thead>
					<tr>
						<th scope="col">Field</th>
						<th scope="col">Column in the file</th>
						<th scope="col">Transform</th>
					</tr>
				</thead>
				<tbody>
					{#each targets as t (t.value)}
						<tr>
							<td>
								<span class="text-sm">{t.label}</span>
								<div class="text-xs text-faint">{t.hint}</div>
							</td>
							<td class="min-w-56">
								<Select
									id="map-{t.value}"
									label="Column for {t.label}"
									bind:value={chosen[t.value]}
									options={columnOptions}
								/>
							</td>
							<td class="min-w-56">
								{#if chosen[t.value] && transforms[t.value]}
									<TransformField
										id="map-{t.value}"
										label="Transform for {t.label}"
										{licensed}
										bind:draft={transforms[t.value]}
									/>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</Table>

			<RadioGroup
				label="When an entry already exists"
				hint="The key field decides which entry a row is. Without one, every row is a new entry."
				bind:value={mode}
				options={[
					{ value: 'create', label: 'Create only', description: 'Leave an entry the key finds alone and report the row as skipped.' },
					{ value: 'upsert', label: 'Create and update', description: 'Overwrite the fields of an entry the key finds, and create the rest.' },
				]}
			/>
			<Select id="import-key" label="Key field" bind:value={key} options={keyOptions} />
		{:else if step === 2 && checked}
			<div class="grid gap-3 sm:grid-cols-3">
				<Stat size="sm" mono label="Rows in the file" value={formatCount(checked.total_rows)} />
				<Stat size="sm" mono label="Would import" value={formatCount(checked.valid_rows)} tone="success" />
				<Stat
					size="sm"
					mono
					label="Would be rejected"
					value={formatCount(checked.error_rows)}
					tone={checked.error_rows > 0 ? 'danger' : undefined}
				/>
			</div>
			{#if checked.errors.length > 0}
				<Table label="Rows the dry run rejected">
					<thead>
						<tr>
							<th scope="col">Row</th>
							<th scope="col">Why</th>
						</tr>
					</thead>
					<tbody>
						{#each checked.errors.slice(0, 50) as e, i (i)}
							<tr>
								<td data-cell="nowrap" class="font-mono text-xs">{e.row_index < 0 ? 'All' : e.row_index + 1}</td>
								<td class="text-xs">{e.message}</td>
							</tr>
						{/each}
					</tbody>
				</Table>
				<p class="text-xs text-muted">
					Importing now writes the {formatCount(checked.valid_rows)} good rows and records the rest with their
					reasons, so they can be downloaded, fixed and imported again.
				</p>
			{:else}
				<Alert tone="success">Every row passes. {mode === 'upsert' ? 'Rows the key finds are updated.' : ''}</Alert>
			{/if}
			<p class="flex items-center gap-2 text-xs text-muted">
				<Badge tone="neutral">{mode === 'upsert' ? 'Create and update' : 'Create only'}</Badge>
				{key ? `Key: ${key === 'entry.slug' ? 'entry slug' : key}` : 'No key'}
			</p>
		{/if}
	</div>

	{#snippet footer()}
		{#if step === 0}
			<Button variant="secondary" onclick={() => (open = false)}>Cancel</Button>
			<Button variant="primary" loading={busy} onclick={readSource}>Read the file</Button>
		{:else if step === 1}
			<Button variant="secondary" onclick={() => (step = 0)}>Back</Button>
			<Button variant="primary" loading={busy} onclick={dryRun}>Dry run</Button>
		{:else}
			<Button variant="secondary" onclick={() => (step = 1)}>Back</Button>
			<Button variant="primary" loading={busy} disabled={importable === 0} onclick={importRows}>
				Import {formatCount(importable)} {importable === 1 ? 'row' : 'rows'}
			</Button>
		{/if}
	{/snippet}
</Drawer>
