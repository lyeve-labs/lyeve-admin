<script lang="ts">
	import { Alert, Badge, Button, Checkbox, Collapsible, CopyButton, Input, SectionHeading, SegmentedControl, Select, type SelectOption } from '@lyeve-labs/ui-kit';
	import type { FieldType, Schema, SchemaField, TransportMode, TransportName } from '@lyeve-labs/client';
	import { dndzone, type DndEvent } from 'svelte-dnd-action';
	import type { Action } from 'svelte/action';
	import { BookOpen, Code, GripVertical, Link2, Pencil, Plus, Trash2, TriangleAlert } from '@lucide/svelte';
	import { collectionRoutes } from '$lib/api/collection-api';
	import { curlFor } from '$lib/api/request-preview';
	import { RELATION_KINDS, planRelation, planSchemaRelations, tableName, type RelationType } from '$lib/relations';
	import { dropUnlocalizableMark, fieldNameTarget, localizableProblem, type Problem } from '$lib/schema/editor';
	import { ICON } from '$lib/icon';
	import { methodTone } from '$lib/tones';
	import SchemaHistory from './SchemaHistory.svelte';
	import type { DdlHistory } from './ddl-history.svelte';
	import { addField, addRelation, dropInertFlags, fieldLabel, inertFlags, isTimestamp, removeField } from './schema-fields';

	/**
	 * The editor for one schema. The list view shows it beside the rail and the
	 * canvas in a panel beside the diagram, so both edit the same way.
	 *
	 * The schema is the page's own state, bound so the edits land where the
	 * page reads dirty, problems and the undo stack. The cleared-mark notes are
	 * bound too, so they outlive a switch between the list and the canvas.
	 */
	let {
		schema = $bindable(),
		localizedCleared = $bindable(),
		saved,
		schemas,
		canWrite,
		isNewSchema,
		dirty,
		saveError,
		problems,
		isSuperAdmin,
		ddl,
		onrename,
	}: {
		schema: Schema;
		localizedCleared: Record<string, string>;
		saved: Schema | null;
		schemas: Schema[];
		canWrite: boolean;
		isNewSchema: boolean;
		dirty: boolean;
		saveError: string;
		problems: Problem[];
		isSuperAdmin: boolean;
		ddl: DdlHistory;
		onrename: () => void;
	} = $props();

	type SystemColumn = 'with_created_at' | 'with_updated_at' | 'with_soft_delete' | 'with_localization';

	/**
	 * The field types, grouped and searchable.
	 *
	 * The labels stay the machine names the API stores, so what the picker says
	 * is what the schema holds and what the docs call it. The friendly words go
	 * in `keywords`, where they find the row without renaming it.
	 */
	const FIELD_TYPE_OPTIONS: SelectOption[] = [
		{ value: 'text', label: 'text', group: 'Text', keywords: ['string', 'varchar'] },
		{ value: 'rich_text', label: 'rich_text', group: 'Text', keywords: ['html', 'body', 'wysiwyg'] },
		{ value: 'email', label: 'email', group: 'Text' },
		{ value: 'url', label: 'url', group: 'Text', keywords: ['link', 'href'] },
		{ value: 'uid', label: 'uid', group: 'Text', keywords: ['slug', 'identifier', 'uuid'] },
		{ value: 'number', label: 'number', group: 'Numbers and dates', keywords: ['int', 'float', 'decimal'] },
		{ value: 'boolean', label: 'boolean', group: 'Numbers and dates', keywords: ['true', 'false', 'flag'] },
		{ value: 'date', label: 'date', group: 'Numbers and dates' },
		{ value: 'datetime', label: 'datetime', group: 'Numbers and dates', keywords: ['timestamp'] },
		{ value: 'json', label: 'json', group: 'Structured', keywords: ['object', 'array'] },
		{ value: 'media', label: 'media', group: 'Structured', keywords: ['image', 'file', 'upload'] },
		// Its own group, so the heading says the word. Under Structured it would
		// sit below the fold of a picker that opens scrolled to the top, past
		// media, where nobody looking for relations thinks to scroll.
		{ value: 'relation', label: 'relation', group: 'Relations', keywords: ['foreign key', 'fk', 'reference', 'join', 'belongs to', 'has many'] },
	];

	/**
	 * The relation kinds, read from the module that knows what each one does.
	 *
	 * Each label is the kind in a few words, short enough for every kind to
	 * stay in sight in one row. The panel under the row names the chosen
	 * kind's cardinality and machine name, so a reader who knows `belongs_to`
	 * still finds it and a reader who does not is told what it means.
	 */
	const RELATION_OPTIONS: { value: RelationType; label: string }[] = RELATION_KINDS.map((k) => ({
		value: k.type,
		label: k.label,
	}));

	// A schema is served over every transport until it says otherwise, so each
	// control shows "Read and write" for a schema that carries no block at all
	// and one is only written once something is narrowed.
	const TRANSPORTS: { key: TransportName; label: string; hint: string }[] = [
		{ key: 'rest', label: 'REST', hint: 'The content API.' },
		{ key: 'graphql', label: 'GraphQL', hint: 'Queries, mutations, subscriptions.' },
		{ key: 'grpc', label: 'gRPC', hint: 'The content and schema services.' },
	];

	const TRANSPORT_MODE_OPTIONS: { value: TransportMode; label: string }[] = [
		{ value: 'rw', label: 'Read and write' },
		{ value: 'r', label: 'Read only' },
		{ value: 'w', label: 'Write only' },
		{ value: 'off', label: 'Not served' },
	];

	function transportMode(s: Schema, key: TransportName): TransportMode {
		return s.transports?.[key] ?? 'rw';
	}

	function setTransport(key: TransportName, mode: TransportMode) {
		const next: Partial<Record<TransportName, TransportMode>> = {
			...(schema.transports ?? {}),
			[key]: mode,
		};
		// Drop the keys that say nothing. Storing "rw" on every transport would
		// turn a default nobody chose into a decision the definition records,
		// and the next reader could not tell the two apart.
		for (const k of Object.keys(next) as TransportName[]) {
			if (next[k] === 'rw') delete next[k];
		}
		schema.transports = Object.keys(next).length > 0 ? next : undefined;
	}

	/** Which schemas a relation may point at. Only has_many may point at its own. */
	function targetOptions(from: Schema, field: SchemaField): SelectOption[] {
		return schemas
			.filter((s) => s.name !== from.name || field.relation_type === 'has_many')
			.map((s) => ({
				value: s.name,
				label: s.display_name || s.name,
				keywords: [s.name, tableName(s.name)],
			}));
	}

	/**
	 * Keeps a row's keystrokes out of the drag zone.
	 *
	 * svelte-dnd-action puts a keydown listener on the row and reads Enter,
	 * Space and the arrow keys on it as drag commands. The listener that stops
	 * them has to be a real one on the element around the controls: an
	 * `onkeydown` attribute is delegated from the document root and runs after
	 * the event has already bubbled past the row, so stopping propagation there
	 * stops nothing. The kit's Checkbox and Select render their own input, so
	 * this is also the only element the page can reach.
	 */
	const keysStayInRow: Action<HTMLElement> = (node) => {
		const stop = (e: KeyboardEvent) => e.stopPropagation();
		node.addEventListener('keydown', stop);
		return {
			destroy() {
				node.removeEventListener('keydown', stop);
			},
		};
	};

	/**
	 * Relations that will not resolve as configured.
	 *
	 * An inverse relation depends on a field of another schema, which is the one
	 * thing this page cannot show in the row that declares it. Without the
	 * summary the only way to find a broken one is to open every relation field
	 * in turn.
	 */
	let brokenRelations = $derived(planSchemaRelations(schema, schemas).filter((r) => r.plan.problem !== null));

	const problemFor = (id: string) => problems.find((p) => p.fieldId === id && p.target === fieldNameTarget(id))?.message;
	const schemaNameProblem = $derived(problems.find((p) => p.fieldId === null)?.message);
	const problemAt = (target: string) => problems.find((p) => p.target === target)?.message;

	/**
	 * The kit's segmented control takes neither an id nor a description, so its
	 * wrapper hands both to the radio group inside it. The problem list finds a
	 * control by its id, and a screen reader reads the hint or the problem the
	 * group names when focus enters it.
	 */
	const groupNamed: Action<HTMLElement, { id: string; describedBy?: string }> = (node, initial) => {
		const apply = (p: { id: string; describedBy?: string }) => {
			const group = node.querySelector('[role="radiogroup"]');
			if (!group) return;
			group.id = p.id;
			if (p.describedBy) group.setAttribute('aria-describedby', p.describedBy);
			else group.removeAttribute('aria-describedby');
		};
		apply(initial);
		return { update: apply };
	};

	/**
	 * Why a row's localized mark was just cleared, by row id. It stays beside
	 * the row until the field can carry the mark again, so the change the
	 * operator did not ask for is never silent. The page holds the record.
	 */
	function followLocalizable(field: SchemaField, key: string) {
		const why = dropUnlocalizableMark(field);
		if (why !== null) localizedCleared[key] = why;
		else if (localizableProblem(field) === null) delete localizedCleared[key];
	}

	function setFieldType(field: SchemaField, next: FieldType, rowId: string) {
		field.field_type = next;
		followLocalizable(field, rowId);
		// A relation with no type saves as a relation to nothing. The picker
		// beside this one already reads as belongs_to, so the field agrees with
		// what the operator can see rather than with an empty box behind it.
		if (next === 'relation' && !field.relation_type) field.relation_type = 'belongs_to';
		dropInertFlags(field);
	}

	/**
	 * The reorder animation runs on the theme's base rung. The library takes a
	 * number rather than a class, so the token is read once, and the fallback
	 * is the token's own value for the first render on the server.
	 */
	const FLIP_MS =
		typeof document === 'undefined'
			? 200
			: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--duration-base')) || 200;

	function handleDnd(e: CustomEvent<DndEvent<SchemaField>>) {
		// Keep top system fields (id, etc.) at the front, timestamp fields at the back.
		const topSys = schema.fields.filter((f) => f.system && !isTimestamp(f));
		const bottomSys = schema.fields.filter((f) => f.system && isTimestamp(f));
		const user = e.detail.items.filter((f) => !f.system);
		schema.fields = [...topSys, ...user, ...bottomSys];
	}

	/** Toggles a system column the engine manages. Removing one that exists is named at save. */
	function toggleSystemColumn(field: SystemColumn, checked: boolean) {
		schema[field] = checked;
	}

	// Derived field groupings, updated whenever the schema changes.
	let topSysFields = $derived(schema.fields.filter((f) => f.system && !isTimestamp(f)));
	let userFields = $derived(schema.fields.filter((f) => !f.system));
	let bottomSysFields = $derived(schema.fields.filter((f) => f.system && isTimestamp(f)));
	let savedTsNames = $derived(new Set(bottomSysFields.map((f) => f.name)));
</script>

<!-- A field the server owns. It sits in the same columns as an editable row so
     the Req and Idx boxes below stay under their headings. -->
{#snippet lockedField(name: string, type: string, note: string)}
	<div class="flex items-center gap-3 rounded-lg border border-line/40 bg-surface p-3">
		<span class="w-3.5 shrink-0"></span>
		<span class="min-w-0 flex-1">
			<span class="text-sm font-medium text-brand">{name}</span>
			<span class="ms-2 text-xs text-faint">{note}</span>
		</span>
		<span class="shrink-0 sm:w-36"><Badge>{type}</Badge></span>
		<span class="hidden w-10 shrink-0 sm:block"></span>
		<span class="hidden w-10 shrink-0 sm:block"></span>
		<span class="hidden w-5 shrink-0 sm:block"></span>
	</div>
{/snippet}

<!-- A column the next save will create, drawn dashed because it does not exist yet. -->
{#snippet plannedField(name: string, type: string, note: string, role: string)}
	<div class="flex items-center gap-3 rounded-lg border border-dashed border-line/50 bg-surface/60 p-3">
		<span class="w-3.5 shrink-0"></span>
		<div class="min-w-0 flex-1">
			<span class="text-sm font-medium text-brand/70">{name}</span>
			<span class="ms-2 text-xs text-faint italic">{role}</span>
			<p class="mt-0.5 text-xs text-faint">{note}</p>
		</div>
		<span class="shrink-0 sm:w-36"><Badge>{type}</Badge></span>
		<span class="hidden w-10 shrink-0 sm:block"></span>
		<span class="hidden w-10 shrink-0 sm:block"></span>
		<span class="hidden w-5 shrink-0 sm:block"></span>
	</div>
{/snippet}

<div class="min-h-0 min-w-0 flex-1 overflow-auto p-6">
<div class="flex flex-col gap-4">
	<!-- The live region is mounted whether or not there is a message in
	     it. Alert carries role="alert", but an element inserted into the
	     page at the moment of the failure is announced inconsistently.
	     A region already in the tree is a change a reader is watching. -->
	<div aria-live="assertive" aria-atomic="true">
		{#if saveError}
			<div data-testid="save-error">
				<Alert tone="danger">{saveError}</Alert>
			</div>
		{/if}
	</div>


	<fieldset disabled={!canWrite} class="flex min-w-0 flex-col gap-4">
	<legend class="sr-only">Definition of {schema.display_name || schema.name || 'the new schema'}</legend>
	<div class="grid min-w-0 gap-3 sm:grid-cols-2">
		<Input
			id="schema-display-name"
			label="Display name"
			placeholder="Schema display name"
			bind:value={schema.display_name}
		/>
		{#if saved}
			<!-- A saved table moves only through Rename, which takes its rows
			     with it. Edited here, the new name would save a second, empty
			     table. -->
			<div class="flex items-end gap-2">
				<Input
					id="schema-name"
					label="Machine name"
					value={schema.name}
					readonly
					class="flex-1"
					mono
				/>
				{#if canWrite}
					<Button
						variant="secondary"
						onclick={onrename}
						disabled={dirty}
						hint={dirty ? 'Save or undo the changes first' : 'Rename the table and its API path'}
					>
						<Pencil size={ICON.sm} /> Rename
					</Button>
				{/if}
			</div>
		{:else}
			<Input
				id="schema-name"
				label="Machine name"
				placeholder="schema_name"
				hint="The table name and the API path. Letters, digits and underscores."
				bind:value={schema.name}
				error={schemaNameProblem}
			/>
		{/if}
	</div>

	<!-- What the engine keeps beside the fields. Open for a new schema,
	     where it is chosen. Folded for a saved one, where the fields are
	     what is being edited and this would push them down the page. -->
	<Collapsible label="Table settings" open={isNewSchema}>
		<div class="flex flex-col gap-4">
			<div class="flex flex-wrap items-center gap-x-6 gap-y-3">
				<Checkbox
					size="sm"
					label="created_at"
					checked={schema.with_created_at ?? false}
					onchange={(checked) => toggleSystemColumn('with_created_at', checked)}
				/>
				<Checkbox
					size="sm"
					label="updated_at"
					checked={schema.with_updated_at ?? false}
					onchange={(checked) => toggleSystemColumn('with_updated_at', checked)}
				/>
				<Checkbox
					size="sm"
					label="soft_delete"
					checked={schema.with_soft_delete ?? false}
					onchange={(checked) => toggleSystemColumn('with_soft_delete', checked)}
				/>
				{#if saved && schema.with_localization}
					<!-- Translations live per entry and per locale in the
					     localization plugin, and the _locale column this flag adds is
					     read by nothing. A schema that carries it keeps its column and
					     shows the flag as it is. A new schema is never offered it. -->
					<Checkbox
						size="sm"
						label="localization"
						checked={true}
						disabled
						hint="Not read: translations are kept per entry and locale"
					/>
				{/if}
				<span class="text-xs text-faint">System columns the engine maintains.</span>
			</div>
			<div class="border-t border-line pt-4">
				<div class="mb-3">
					<SectionHeading level={3}>Transports</SectionHeading>
					<span class="mt-1 block text-xs text-faint">
						Where this schema is served. A new schema is read and write on all
						three until it is narrowed here.
					</span>
				</div>
				<div class="flex flex-col gap-3">
					{#each TRANSPORTS as t (t.key)}
						<div
							class="flex min-w-0 flex-col gap-1"
							data-testid="transport-{t.key}"
							use:groupNamed={{ id: `transport-${t.key}`, describedBy: `transport-${t.key}-hint` }}
						>
							<SegmentedControl
								label={t.label}
								size="sm"
								class="max-w-full overflow-x-auto"
								options={TRANSPORT_MODE_OPTIONS}
								value={transportMode(schema, t.key)}
								onchange={(v) => setTransport(t.key, v)}
							/>
							<span id="transport-{t.key}-hint" class="text-xs text-faint">{t.hint}</span>
						</div>
					{/each}
				</div>
			</div>
		</div>
	</Collapsible>

	{#if brokenRelations.length > 0}
		<div data-testid="relation-problems">
			<Alert tone="warn">
				<span class="flex items-start gap-2">
					<TriangleAlert size={ICON.sm} class="mt-0.5 shrink-0" />
					<span>
						{brokenRelations.length}
						{brokenRelations.length === 1 ? 'relation' : 'relations'} on this schema
						will not resolve as configured. An inverse relation depends on a field of
						the other schema, which is the one thing its own row cannot show.
						<span class="mt-1 block space-y-0.5">
							{#each brokenRelations as r (r.field.id ?? r.field.name)}
								<span class="block">
									<span class="font-mono">{r.field.name || 'unnamed field'}</span>:
									{r.plan.problem}
								</span>
							{/each}
						</span>
					</span>
				</span>
			</Alert>
		</div>
	{/if}

<div class="space-y-2">
	<!-- The Req and Idx boxes in the rows below are named by these two
	     headings, so each box repeats the heading and adds its field. -->
	<!-- The column labels line up with the row's fixed widths, which
	     only hold from sm: up. Below it the row wraps and each box
	     carries its own short label instead. -->
	<div class="hidden items-center gap-3 px-3 text-xs text-faint sm:flex">
		<span class="w-3.5 shrink-0"></span>
		<span class="flex-1">Field</span>
		<span class="w-36 shrink-0">Type</span>
		<span class="w-10 shrink-0 text-center">Req</span>
		<span class="w-10 shrink-0 text-center">Idx</span>
		<span class="w-5 shrink-0"></span>
	</div>

	{#if topSysFields.length > 0}
		{#each topSysFields as field (field.id ?? field.name)}
			{@render lockedField(field.name, field.field_type, 'system, required, indexed')}
		{/each}
	{:else}
		{@render plannedField('id', 'uid', 'Generated UUID. Unique, indexed and not editable.', 'auto, system')}
	{/if}

	<div
		use:dndzone={{ items: userFields, flipDurationMs: FLIP_MS, dragDisabled: !canWrite }}
		onconsider={handleDnd}
		onfinalize={handleDnd}
		class="space-y-2"
	>
		{#each userFields as field, i (field.id ?? i)}
		{@const rowId = field.id ?? String(i)}
		{@const plan = planRelation(schema, field, schemas)}
		{@const inert = inertFlags(field)}
		<div class="rounded-lg border border-line bg-surface-2">
			<div class="flex items-center gap-3 p-3">
				<GripVertical size={ICON.sm} class="shrink-0 cursor-grab text-faint" />
				<div class="flex min-w-0 flex-1 flex-wrap items-center gap-3" use:keysStayInRow>
					<Input
						id={fieldNameTarget(rowId)}
						name="field-name-{rowId}"
						aria-label="Field name"
						autocomplete="off"
						placeholder="field_name"
						bind:value={field.name}
						error={problemFor(rowId)}
						class="min-w-40 flex-1"
					/>

					<label for="field-type-{rowId}" class="sr-only">
						Type, {fieldLabel(field)}
					</label>
					<Select
						id="field-type-{rowId}"
						searchable
						options={FIELD_TYPE_OPTIONS}
						value={field.field_type}
						onvaluechange={(v) => setFieldType(field, v as FieldType, rowId)}
						class="w-36 shrink-0"
					/>

					<div class="flex shrink-0 items-center gap-1.5 sm:w-10 sm:justify-center" title={inert.required ?? undefined}>
						<span class="text-xs text-faint sm:hidden" aria-hidden="true">Req</span>
						<Checkbox
							size="sm"
							label="Required, {fieldLabel(field)}"
							labelHidden
							checked={field.required}
							disabled={inert.required !== null}
							onchange={(checked) => (field.required = checked)}
						/>
					</div>
					<div class="flex shrink-0 items-center gap-1.5 sm:w-10 sm:justify-center" title={inert.indexed ?? undefined}>
						<span class="text-xs text-faint sm:hidden" aria-hidden="true">Idx</span>
						<Checkbox
							size="sm"
							label="Indexed, {fieldLabel(field)}"
							labelHidden
							checked={field.indexed}
							disabled={inert.indexed !== null}
							onchange={(checked) => (field.indexed = checked)}
						/>
					</div>
					<!-- Translatable. It generates no column, because a
					     translation is stored once per entry and locale, so
					     marking a field runs no migration. The box is
					     disabled rather than hidden where it cannot apply,
					     and says why: hiding it would leave somebody looking
					     for a control the engine does have. -->
					<div
						class="flex shrink-0 items-center gap-1.5 sm:w-10 sm:justify-center"
						title={localizableProblem(field) ?? 'Translated per locale.'}
					>
						<span class="text-xs text-faint sm:hidden" aria-hidden="true">i18n</span>
						<Checkbox
							size="sm"
							label="Translated per locale, {fieldLabel(field)}"
							labelHidden
							checked={field.localized === true}
							disabled={localizableProblem(field) !== null}
							onchange={(checked) => (field.localized = checked)}
						/>
					</div>
					{#if canWrite}
					<button
						type="button"
						onclick={() => removeField(schema, rowId)}
						aria-label="Remove field {fieldLabel(field)}"
						class="relative hit-area flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-faint transition-colors duration-base hover:bg-surface-2 hover:text-danger"
					>
						<Trash2 size={ICON.sm} />
					</button>
					{/if}
				</div>
			</div>

			{#if localizedCleared[rowId] && localizableProblem(field) !== null}
				<p id="localized-note-{rowId}" class="px-3 pb-3 text-xs text-muted">
					No longer translated per locale. {localizedCleared[rowId]}
				</p>
			{/if}

			{#if field.field_type === 'relation'}
				<!-- Its own band under the row rather than three more boxes
				     inside it. On the same line as the name, the type and two
				     checkboxes, every relation control is too narrow to read
				     and nothing has room to say what the relation does. -->
				<div
					class="space-y-3 border-t border-line/60 bg-surface/60 p-3"
					data-testid="relation-panel-{rowId}"
					use:keysStayInRow
				>
					<!-- The problem list moves focus to the kind's radio group by its
					     id, and the group names the problem as its description. -->
					<div
						class="flex min-w-0 flex-col gap-1"
						use:groupNamed={{ id: `relation-type-${rowId}`, describedBy: problemAt(`relation-type-${rowId}`) ? `relation-type-${rowId}-problem` : undefined }}
					>
						<SegmentedControl
							label="Relation"
							size="sm"
							class="max-w-full overflow-x-auto"
							options={RELATION_OPTIONS}
							value={field.relation_type ?? 'belongs_to'}
							onchange={(v) => {
								field.relation_type = v;
								dropInertFlags(field);
							}}
						/>
						{#if problemAt(`relation-type-${rowId}`)}
							<p id="relation-type-{rowId}-problem" class="text-xs text-danger">{problemAt(`relation-type-${rowId}`)}</p>
						{/if}
					</div>
					<div class="grid gap-3 sm:grid-cols-2">
						<Select
							id="relation-target-{rowId}"
							label="Target schema"
							error={problemAt(`relation-target-${rowId}`)}
							searchable
							placeholder="Pick a schema"
							options={targetOptions(schema, field)}
							value={field.relation_to ?? ''}
							onvaluechange={(v) => {
								field.relation_to = v;
							}}
						/>
					</div>

					{#if plan}
						<p class="text-sm text-fg">{plan.sentence}</p>

						<dl class="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-[auto_1fr]">
							<dt class="text-faint">Cardinality</dt>
							<dd class="text-muted">{plan.kind.cardinality}</dd>
							<dt class="text-faint">Stored as</dt>
							<dd class="font-mono text-muted">{plan.kind.type}</dd>
							<dt class="text-faint">Key lives in</dt>
							<dd class="text-muted">{plan.kind.storage}</dd>
							<dt class="text-faint">Read through</dt>
							<dd class="font-mono text-muted">{plan.reads}</dd>
							<dt class="text-faint">Req and Idx</dt>
							<dd class="text-muted">{plan.flags}</dd>
						</dl>

						{#if plan.creates.length > 0}
							<div>
								<p class="mb-1 text-xs text-faint">Saving creates</p>
								<ul class="space-y-0.5 text-xs text-muted">
									{#each plan.creates as line (line)}
										<li>{line}</li>
									{/each}
								</ul>
							</div>
						{:else}
							<p class="text-xs text-faint">
								Saving creates nothing here. This side of the relation is read
								from the other schema.
							</p>
						{/if}

						{#if plan.problem}
							<Alert tone="warn">
								{plan.problem}
								{#if plan.requires && !plan.requires.satisfied}
									Add a field named
									<span class="font-mono">{plan.requires.field}</span>
									to <span class="font-medium">{plan.requires.schema}</span>,
									typed relation, kind "Belongs to one", pointing back here.
								{/if}
							</Alert>
						{/if}
					{:else}
						<p class="text-xs text-faint">
							Pick a target schema to see which table this relation writes and
							what saving it creates.
						</p>
					{/if}
				</div>
			{/if}
		</div>
	{/each}
	</div>

	{#each bottomSysFields as field (field.id ?? field.name)}
		{@render lockedField(field.name, 'datetime', 'system, set automatically')}
	{/each}
	{#if schema.with_created_at && !savedTsNames.has('created_at')}
		{@render plannedField('created_at', 'datetime', 'Set on insert. Not editable.', 'auto, system')}
	{/if}
	{#if schema.with_updated_at && !savedTsNames.has('updated_at')}
		{@render plannedField('updated_at', 'datetime', 'Set on every write. Not editable.', 'auto, system')}
	{/if}
	{#if schema.with_soft_delete}
		{@render plannedField('deleted_at', 'datetime', 'Set when a row is soft-deleted. NULL for active rows.', 'system, soft delete')}
	{/if}
	{#if schema.with_localization}
		{@render plannedField('_locale', 'text', 'The localization plugin keeps a translation per entry and per locale, and nothing reads this column.', 'system, not read')}
	{/if}
</div>

{#if canWrite}
<div class="flex flex-wrap items-center gap-2">
	<Button variant="outline" size="sm" class="border-dashed" onclick={() => addField(schema)}>
		<Plus size={ICON.sm} /> Add field
	</Button>
	<Button variant="outline" size="sm" class="border-dashed" onclick={() => addRelation(schema)}>
		<Link2 size={ICON.sm} /> Add relation
	</Button>
	<span class="text-xs text-faint">
		A relation is a field typed <span class="font-mono">relation</span>.
	</span>
</div>
{/if}

</fieldset>

<!-- The four relation kinds are four different database objects, and
     the picker shows them as four words. This is the page saying
     which is which, once, rather than each row saying it again. -->
<Collapsible label="How relations work" icon={BookOpen}>
	<div class="space-y-4 text-sm text-muted">
		<p>
			Add one with <span class="font-medium text-fg">Add relation</span>, or
			set any field's type to <span class="font-mono">relation</span>. The row
			grows a panel that asks for the kind and the target schema, then says
			which table the relation writes and what saving it creates. The kinds:
		</p>

		<div class="overflow-x-auto">
			<table class="w-full min-w-[36rem] border-collapse text-left text-xs">
				<thead>
					<tr class="border-b border-line text-faint">
						<th scope="col" class="py-2 pe-4 font-medium">Kind</th>
						<th scope="col" class="py-2 pe-4 font-medium">Cardinality</th>
						<th scope="col" class="py-2 pe-4 font-medium">Key lives in</th>
						<th scope="col" class="py-2 font-medium">What saving creates</th>
					</tr>
				</thead>
				<tbody>
					{#each RELATION_KINDS as k (k.type)}
						<tr class="border-b border-line/50 align-top">
							<td class="py-2 pe-4">
								<span class="block text-fg">{k.label}</span>
								<span class="font-mono text-faint">{k.type}</span>
							</td>
							<td class="py-2 pe-4">{k.cardinality}</td>
							<td class="py-2 pe-4">{k.storage}</td>
							<td class="py-2">{k.blurb}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		<p>
			An inverse relation is read through a column named after
			<em>this schema</em>, not after the field. An
			<span class="font-mono">author</span> with a
			<span class="font-mono">has_many</span> field called
			<span class="font-mono">articles</span> resolves through
			<span class="font-mono">author_id</span> on
			<span class="font-mono">_article</span>, so the field can be called
			anything and renaming it moves nothing in the database. What it does
			need is a <span class="font-mono">belongs_to</span> field named
			<span class="font-mono">author</span> on the other schema.
		</p>

		<p>
			A relation is not a column you fill in. Only
			<span class="font-mono">belongs_to</span> adds one here. The other
			three are answered from somewhere else, so a schema whose relations
			all point outward has no relation columns of its own and that is
			correct.
		</p>

		<p>
			Required changes what a delete does. A required
			<span class="font-mono">belongs_to</span> deletes this row when the
			row it points at goes. An optional one keeps this row and empties the
			key.
		</p>
	</div>
</Collapsible>

{#if saved}
	<Collapsible label="This collection's API" icon={Code}>
		<div class="space-y-3 text-sm text-muted">
			<p>
				The content API routes this collection by its machine name. Reads take a
				bearer token. Writes need the editor, admin or super_admin role. Every
				parameter is in the
				<a href="/admin/api-reference" class="text-brand hover:underline">API reference</a>.
			</p>
			<ul class="space-y-2">
				{#each collectionRoutes(schema.name) as route (route.method + route.path)}
					{@const preview = curlFor(route)}
					<li class="rounded-lg border border-line bg-surface p-3">
						<div class="flex flex-wrap items-center gap-2">
							<Badge tone={methodTone(route.method)} class="font-mono">{route.method}</Badge>
							<code class="min-w-0 flex-1 truncate font-mono text-xs text-fg">{route.path}</code>
							<span class="text-xs text-faint">{route.summary}</span>
							<CopyButton
								value={preview}
								label="Copy a curl request for {route.method} {route.path}"
								size={ICON.xs}
								class="shrink-0"
							/>
						</div>
					</li>
				{/each}
			</ul>
		</div>
	</Collapsible>

	{#if isSuperAdmin}
		<SchemaHistory {ddl} />
	{/if}
{/if}
</div>
</div>
