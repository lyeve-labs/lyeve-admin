<script lang="ts">
	import PageTitle from '$lib/components/PageTitle.svelte';
	import {
		Alert,
		Badge,
		Button,
		ButtonGroup,
		Card,
		Checkbox,
		Collapsible,
		Drawer,
		Dropdown,
		EmptyState,
		FileInput,
		Input,
		Modal,
		PageShell,
		SearchInput,
		SectionHeading,
		SegmentedControl,
		Select,
		Textarea,
		confirm,
		toast,
		Toolbar,
		type SelectOption,
	} from '@lyeve-labs/ui-kit';
	import type { ActionData, PageData } from './$types';
	import type { DryRunStatement, HistoryEntry, ImportPlan } from './+page.server';
	import { IMPORT_SOURCES } from './import-sources';
	import { enhance } from '$app/forms';
	import { beforeNavigate, goto, invalidateAll } from '$app/navigation';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { tick, untrack } from 'svelte';
	import type {
		Schema,
		SchemaField,
		FieldType,
		TransportName,
		TransportMode,
	} from '@lyeve-labs/client';
	import { dndzone, type DndEvent } from 'svelte-dnd-action';
	import type { Action } from 'svelte/action';
	import {
		BookOpen,
		Check,
		Code,
		Copy,
		Download,
		Ellipsis,
		Eye,
		GripVertical,
		History,
		LayoutTemplate,
		Link2,
		List,
		Network,
		Pencil,
		Plus,
		Redo2,
		Save,
		Table2,
		Trash2,
		TriangleAlert,
		Undo2,
		Upload,
	} from '@lucide/svelte';
	import type { RelationType } from '$lib/relations';
	import { collectionRoutes } from '$lib/api/collection-api';
	import { curlFor } from '$lib/api/request-preview';
	import { copyText } from '$lib/clipboard';
	import { formatDateTime } from '$lib/format';
	import type { HttpMethod } from '$lib/api/reference';
	import {
		RELATION_KINDS,
		planRelation,
		planSchemaRelations,
		relationKind,
		tableName,
	} from '$lib/relations';
	import {
		appliedMessage,
		canonical,
		changesOf,
		createSchemaHistory,
		fieldNameTarget,
		isRisky,
		problemsOf,
		wireSchema,
		type SchemaHistory,
		localizableProblem,
		dropUnlocalizableMark,
	} from '$lib/schema/editor';
	import ResizableAside from '$lib/components/ResizableAside.svelte';
	import { SchemaCanvas, hasSchemaCanvas } from '$lib/canvas/schema';
	import NotEnabled from '$lib/components/NotEnabled.svelte';
	import type { Positions } from '$lib/api/schema-canvas-layout';
	import type { SchemaCanvasApi } from '$lib/canvas/contract';
	import ProblemsMenu from '$lib/components/ProblemsMenu.svelte';
	import { ICON } from '$lib/icon';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	// The schema plugin says whether this install draws the canvas and saves
	// a custom preset. Without either the list editor is the whole builder and
	// the built-in presets stay.
	const canvasLicensed = $derived(data.canvas?.licensed === true);
	const canSavePresets = $derived(data.canSavePresets === true);

	// The canvas reports every position after a gesture that moves a node,
	// and the layout is saved on the instance for every admin of the tenant.
	// A burst of moves sends the last one, and nothing reloads the page.
	let layoutForm = $state<HTMLFormElement>();
	let layoutJSON = $state('{}');
	let layoutTimer: ReturnType<typeof setTimeout> | undefined;
	function saveLayout(positions: Positions) {
		layoutJSON = JSON.stringify(positions);
		clearTimeout(layoutTimer);
		layoutTimer = setTimeout(() => layoutForm?.requestSubmit(), 400);
	}
	const layoutSubmit: SubmitFunction = () => {
		return async ({ result }) => {
			if (result.type === 'failure') toast.error(String((result.data as { layoutError?: string })?.layoutError ?? 'The layout could not be saved.'));
		};
	};

	// Every schema write takes admin or super_admin. An editor reads the
	// definitions and is not handed controls that end in a 403.
	const canWrite = $derived(data.canWrite === true);

	type SystemColumn = 'with_created_at' | 'with_updated_at' | 'with_soft_delete' | 'with_localization';

	function withIds(s: Schema): Schema {
		return {
			...s,
			fields: s.fields.map((f) => (f.id ? f : { ...f, id: crypto.randomUUID() })),
		};
	}

	// svelte-ignore state_referenced_locally
	let schemas = $state<Schema[]>((data.schemas ?? []).map(withIds));
	// svelte-ignore state_referenced_locally
	let loadedSchemas = data.schemas;

	// The list is local state so a save or a delete edits it in place, and
	// the load reruns only after a preset action or a partial save, when the
	// engine holds schemas this page has not seen. That rerun is the one time
	// the server's list replaces the local one.
	$effect(() => {
		if (data.schemas === loadedSchemas) return;
		loadedSchemas = data.schemas;
		schemas = (data.schemas ?? []).map(withIds);
	});

	/**
	 * Row counts arrive after the page paints. The load streams them, so a
	 * tenant with many schemas sees the list at once and the figures a moment
	 * later. A count that could not be read is left out rather than shown as 0.
	 */
	let rowCounts = $state<Record<string, number>>({});
	$effect(() => {
		const pending = data.rowCounts;
		let live = true;
		void Promise.resolve(pending).then((counts) => {
			if (live) rowCounts = counts ?? {};
		});
		return () => {
			live = false;
		};
	});

	/** How many rows the rail draws before it asks. */
	const PAGE = 100;
	let shown = $state(PAGE);

		// The presets are offered from the empty state and from the toolbar, the
	// way the flow editor offers its templates. Each card posts its own id.
	// The drawer stays open on a refusal so the reason sits beside the card.
	let showPresets = $state(false);
	let presetPending = $state('');
	const presetError = $derived(form && 'preset' in form && 'error' in form && form.error ? form : null);
	const presetCreated = $derived(form && 'created' in form && Array.isArray(form.created) ? form.created : null);
	const hasPresets = $derived((data.presets?.length ?? 0) > 0 || Boolean(data.presetsError));

	// A preset the tenant keeps: read from a URL, a file or a pasted document,
	// and listed with the built-in ones so it can be applied again later.
	let presetSaveError = $state('');
	let presetSaving = $state(false);
	let presetDeleteForm = $state<HTMLFormElement | undefined>();
	let presetDeleteId = $state('');

	const presetSave: SubmitFunction = () => {
		presetSaving = true;
		presetSaveError = '';
		return async ({ result, update, formElement }) => {
			presetSaving = false;
			if (result.type === 'failure') {
				presetSaveError = String((result.data as { saveError?: string })?.saveError ?? 'The preset could not be saved.');
				return;
			}
			if (result.type === 'success') {
				formElement.reset();
				toast.success('Preset saved');
			}
			await update({ reset: false });
		};
	};

	async function deletePreset(id: string, name: string) {
		const ok = await confirm(`Delete the preset ${name}?`, 'The schemas it already created stay. Only the saved preset goes.', { confirmLabel: 'Delete' });
		if (!ok) return;
		presetDeleteId = id;
		await tick();
		presetDeleteForm?.requestSubmit();
	}

	/** The card's submit: marks it busy, then closes the drawer on success. */
	function presetSubmit(id: string): SubmitFunction {
		return () => {
			presetPending = id;
			return async ({ result, update }) => {
				presetPending = '';
				if (result.type !== 'failure' && result.type !== 'error') showPresets = false;
				await update();
			};
		};
	}

	/**
	 * The schema being edited, and the one the server holds for it.
	 *
	 * Dirty is the difference between the two rather than a flag set on the
	 * first keystroke, so an undo back to what was saved reads as saved. A new
	 * schema has no saved side and is dirty until it is.
	 */
	let selected = $state<Schema | null>(null);
	let saved = $state<Schema | null>(null);
	const isNewSchema = $derived(selected !== null && saved === null);
	const dirty = $derived(selected !== null && (saved === null || canonical(selected) !== canonical(saved)));
	let copiedRequest = $state<string | null>(null);

	const methodTone: Record<HttpMethod, 'brand' | 'success' | 'warn' | 'danger'> = {
		GET: 'brand',
		POST: 'success',
		PUT: 'warn',
		PATCH: 'warn',
		DELETE: 'danger',
	};

	async function copyRequest(text: string) {
		if (!(await copyText(text))) return;
		copiedRequest = text;
		setTimeout(() => {
			copiedRequest = null;
		}, 1500);
	}
	let view = $state<'list' | 'canvas'>('list');
	let saveError = $state('');
	let schemaFilter = $state('');

	/**
	 * The undo stack for the schema on screen. Rebuilt whenever another schema
	 * is opened, so an undo never reaches into the one before.
	 */
	let history: SchemaHistory | null = null;
	let historyState = $state({ canUndo: false, canRedo: false });
	let restoring = false;

	function resetHistory(s: Schema | null) {
		history = s ? createSchemaHistory(JSON.parse(JSON.stringify(s)) as Schema) : null;
		historyState = { canUndo: false, canRedo: false };
	}

	$effect(() => {
		if (!selected) return;
		const snap = JSON.parse(JSON.stringify(selected)) as Schema;
		untrack(() => {
			if (restoring || !history) return;
			history.push(snap);
			historyState = { canUndo: history.canUndo(), canRedo: history.canRedo() };
		});
	});

	function undo() {
		const prev = history?.undo();
		if (prev) restore(prev);
	}

	function redo() {
		const next = history?.redo();
		if (next) restore(next);
	}

	function restore(s: Schema) {
		restoring = true;
		selected = s;
		historyState = { canUndo: history?.canUndo() ?? false, canRedo: history?.canRedo() ?? false };
		queueMicrotask(() => (restoring = false));
	}

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
	 * The label is the cardinality in words and the machine name follows it, so
	 * a reader who knows `belongs_to` still finds it and a reader who does not
	 * is told what it means without opening anything.
	 */
	const RELATION_OPTIONS: SelectOption[] = RELATION_KINDS.map((k) => ({
		value: k.type,
		label: `${k.label} (${k.cardinality})`,
		keywords: [k.type, k.storage],
	}));

	// A schema is served over every transport until it says otherwise, so each
	// control shows "Read and write" for a schema that carries no block at all
	// and one is only written once something is narrowed.
	const TRANSPORTS: { key: TransportName; label: string; hint: string }[] = [
		{ key: 'rest', label: 'REST', hint: 'The content API.' },
		{ key: 'graphql', label: 'GraphQL', hint: 'Queries, mutations, subscriptions.' },
		{ key: 'grpc', label: 'gRPC', hint: 'The content and schema services.' },
	];

	const TRANSPORT_MODE_OPTIONS: SelectOption[] = [
		{ value: 'rw', label: 'Read and write' },
		{ value: 'r', label: 'Read only' },
		{ value: 'w', label: 'Write only' },
		{ value: 'off', label: 'Not served' },
	];

	function transportMode(s: Schema, key: TransportName): TransportMode {
		return s.transports?.[key] ?? 'rw';
	}

	function setTransport(key: TransportName, mode: TransportMode) {
		if (!selected) return;
		const next: Partial<Record<TransportName, TransportMode>> = {
			...(selected.transports ?? {}),
			[key]: mode,
		};
		// Drop the keys that say nothing. Storing "rw" on every transport would
		// turn a default nobody chose into a decision the definition records,
		// and the next reader could not tell the two apart.
		for (const k of Object.keys(next) as TransportName[]) {
			if (next[k] === 'rw') delete next[k];
		}
		selected.transports = Object.keys(next).length > 0 ? next : undefined;
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

	/** Names a field in a control's accessible name, before it has been named. */
	function fieldLabel(f: SchemaField): string {
		return f.name || 'new field';
	}

	/** Returns true if a field is a timestamp column (created_at / updated_at). */
	function isTimestamp(f: SchemaField) {
		return f.name === 'created_at' || f.name === 'updated_at';
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
	 * Deep-clone a schema. JSON round-trip, not structuredClone: the schema on
	 * screen is a Svelte state proxy and structuredClone throws on one.
	 */
	function cloneSchema(s: Schema): Schema {
		return withIds(JSON.parse(JSON.stringify(s)));
	}

	/** Opens a schema, and a saved copy of it for dirty and for what a save changes. */
	function open(s: Schema | null, asSaved = true) {
		selected = s ? cloneSchema(s) : null;
		saved = s && asSaved ? JSON.parse(JSON.stringify(selected)) : null;
		saveError = '';
		resetHistory(selected);
	}

	/** Asks before throwing away edits. True when there is nothing to lose or the answer is yes. */
	async function mayDiscard(): Promise<boolean> {
		if (!dirty || !selected) return true;
		return confirm(
			`Discard the changes to ${selected.display_name || selected.name || 'the new schema'}?`,
			'They have not been saved. Save first to keep them.',
			{ confirmLabel: 'Discard' },
		);
	}

	async function selectSchema(s: Schema) {
		// Picking a schema opens its editor where the reader is: beside the rail
		// in the list, beside the diagram on the canvas.
		if (selected && saved?.name === s.name) return;
		if (!(await mayDiscard())) return;
		open(s);
	}

	function addField() {
		if (!selected) return;
		selected.fields = [
			...selected.fields,
			{ id: crypto.randomUUID(), name: '', field_type: 'text', required: false, unique: false, indexed: false },
		];
	}

	/**
	 * A relation is a field whose type is relation, and that is the one fact
	 * the editor never said. This adds one already typed, so the panel that
	 * asks for the kind and the target opens without a trip through the picker.
	 */
	function addRelation(target?: string) {
		if (!selected) return;
		selected.fields = [
			...selected.fields,
			{
				id: crypto.randomUUID(),
				name: target ? relationFieldName(selected, target) : '',
				field_type: 'relation',
				relation_type: 'belongs_to',
				relation_to: target,
				required: false,
				unique: false,
				indexed: false,
			},
		];
	}

	/**
	 * A relation drawn on the canvas arrives with a target and no name. It is
	 * named after the target, or parent when a schema points at itself, with a
	 * number added when the schema already has a field of that name.
	 */
	function relationFieldName(s: Schema, target: string): string {
		const base = target === s.name ? 'parent' : target.toLowerCase();
		const taken = new Set(s.fields.map((f) => f.name));
		if (!taken.has(base)) return base;
		let n = 2;
		while (taken.has(`${base}_${n}`)) n++;
		return `${base}_${n}`;
	}

	/**
	 * Removes a row at once. It is one undo away, and a save that would drop a
	 * column with data in it says so, with the row count, before it runs.
	 */
	function removeField(fieldId: string) {
		if (!selected) return;
		const field = selected.fields.find((f) => f.id === fieldId);
		if (!field || field.system) return;
		selected.fields = selected.fields.filter((f) => f.id !== fieldId);
	}

	/**
	 * Relations that will not resolve as configured.
	 *
	 * An inverse relation depends on a field of another schema, which is the one
	 * thing this page cannot show in the row that declares it. Without the
	 * summary the only way to find a broken one is to open every relation field
	 * in turn.
	 */
	let brokenRelations = $derived.by(() => {
		if (!selected) return [];
		return planSchemaRelations(selected, schemas).filter((r) => r.plan.problem !== null);
	});

	/** What would make a save fail, checked as the operator types. */
	const problems = $derived(
		selected ? problemsOf(selected, schemas.filter((s) => s.name !== saved?.name), isNewSchema) : [],
	);
	const problemFor = (id: string) => problems.find((p) => p.fieldId === id && p.target === fieldNameTarget(id))?.message;
	const schemaNameProblem = $derived(problems.find((p) => p.fieldId === null)?.message);
	const problemAt = (target: string) => problems.find((p) => p.target === target)?.message;
	const problemItems = $derived(problems.map((p, i) => ({ key: `${i}:${p.target}`, where: p.where, what: p.message, target: p.target })));
	let showProblems = $state(false);
	let canvasPanelOpen = $state(true);
	let schemaCanvas = $state<SchemaCanvasApi>();

	/**
	 * Takes the reader to the control that fixes a problem. On the canvas the
	 * editor is the panel beside the diagram, which may be folded to its
	 * strip, so it is opened first and the schema's node brought into view.
	 */
	async function focusProblem(target: string) {
		if (view === 'canvas') {
			canvasPanelOpen = true;
			if (saved?.name) schemaCanvas?.reveal(saved.name);
			await tick();
		}
		const el = document.getElementById(target);
		el?.focus();
		el?.scrollIntoView?.({ block: 'center' });
	}

	/** What a save does to columns that already exist, and how many rows they hold. */
	const change = $derived(selected ? changesOf(saved, selected) : changesOf(null, { name: '', display_name: '', fields: [] }));
	const rowsAtRisk = $derived(saved ? (rowCounts[saved.name] ?? 0) : 0);

	/**
	 * Why a row's localized mark was just cleared, by row id. It stays beside
	 * the row until the field can carry the mark again, so the change the
	 * operator did not ask for is never silent.
	 */
	let localizedCleared = $state<Record<string, string>>({});

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
	 * No relation stores a column under its own name, so Idx on one indexes
	 * nothing and the save fails naming a column the operator never typed. A
	 * belongs_to is indexed by its foreign key already. The other three kinds
	 * keep no column here at all, so Req on them has nothing to make NOT NULL
	 * and the engine skips relations in validation besides.
	 *
	 * A json field cannot be an index key: MySQL refuses one and SQL Server
	 * stores the value where no index reaches, so the engine refuses the save.
	 */
	function inertFlags(field: SchemaField): { indexed: string | null; required: string | null } {
		if (field.field_type === 'json') {
			return { indexed: 'A json field cannot be indexed.', required: null };
		}
		if (field.field_type !== 'relation') return { indexed: null, required: null };
		const kind = relationKind(field.relation_type);
		return {
			indexed:
				kind.type === 'belongs_to'
					? 'Indexed by its foreign key already.'
					: 'No column here to index.',
			required:
				kind.type === 'belongs_to'
					? null
					: 'Nothing here to require. The key lives in ' + kind.storage + '.',
		};
	}

	function dropInertFlags(field: SchemaField) {
		const inert = inertFlags(field);
		if (inert.indexed) field.indexed = false;
		if (inert.required) field.required = false;
		if (field.field_type === 'json') field.unique = false;
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
		if (!selected) return;
		// Keep top system fields (id, etc.) at the front, timestamp fields at the back.
		const topSys = selected.fields.filter((f) => f.system && !isTimestamp(f));
		const bottomSys = selected.fields.filter((f) => f.system && isTimestamp(f));
		const user = e.detail.items.filter((f) => !f.system);
		selected.fields = [...topSys, ...user, ...bottomSys];
	}

	// The writes. Each is a hidden form the toolbar submits, so a save goes
	// through the server the way every other write in the admin does, and the
	// engine's refusals come back as sentences rather than response bodies.
	let saveForm = $state<HTMLFormElement>();
	let previewForm = $state<HTMLFormElement>();
	let deleteForm = $state<HTMLFormElement>();
	let saving = $state(false);
	let previewing = $state(false);
	let previewIntent = $state<'look' | 'save'>('look');

	const schemaJSON = $derived(selected ? JSON.stringify(wireSchema(selected)) : '');
	const renamesJSON = $derived(JSON.stringify(change.renames));

	/**
	 * The one way into a save. A save that renames, retypes or drops a column
	 * on a table that exists shows the DDL and the row count first. Any other
	 * save goes straight through.
	 */
	function requestSave() {
		if (!selected || !canWrite || saving) return;
		if (problems.length > 0) {
			showProblems = true;
			focusProblem(problems[0].target);
			return;
		}
		if (!isNewSchema && isRisky(change)) {
			previewIntent = 'save';
			previewForm?.requestSubmit();
			return;
		}
		saveForm?.requestSubmit();
	}

	function requestPreview() {
		if (!selected?.name) return;
		previewIntent = 'look';
		previewForm?.requestSubmit();
	}

	const submitSave: SubmitFunction = () => {
		saving = true;
		saveError = '';
		return async ({ result }) => {
			saving = false;
			// The confirmation belongs to the save that asked for it, whatever the
			// answer. Left open it would read as a second, unrelated preview.
			closeDDLPreview();
			if (result.type === 'success' && result.data && 'saved' in result.data) {
				const stored = withIds(result.data.saved as Schema);
				const idx = schemas.findIndex((s) => s.name === stored.name);
				if (idx >= 0) schemas[idx] = stored;
				else schemas = [...schemas, stored];
				open(stored);
				toast.success(`Saved ${stored.display_name || stored.name}`);
			} else if (result.type === 'failure') {
				const d = (result.data ?? {}) as { error?: string; renamed?: { from: string; to: string }[] };
				saveError = d.error ?? 'The schema could not be saved.';
				// A rename the engine already ran is part of the saved side now, or
				// the next save would ask it to rename a column that has moved.
				if (saved && d.renamed?.length) {
					for (const r of d.renamed) {
						const f = saved.fields.find((x) => x.name === r.from);
						if (f) f.name = r.to;
					}
				}
			} else if (result.type === 'error') {
				saveError = 'The admin could not reach the engine. Nothing was saved.';
			}
		};
	};

	// The preview result, for the read-only dialog and for the save that asked.
	let ddlPreview = $state<DryRunStatement[] | null>(null);
	let ddlPreviewError = $state('');
	let riskOpen = $state(false);

	const submitPreview: SubmitFunction = () => {
		previewing = true;
		return async ({ result }) => {
			previewing = false;
			if (result.type === 'success' && result.data && 'statements' in result.data) {
				ddlPreview = result.data.statements as DryRunStatement[];
				ddlPreviewError = '';
			} else {
				ddlPreview = [];
				ddlPreviewError =
					result.type === 'failure' && result.data && 'error' in result.data
						? String(result.data.error)
						: 'The DDL could not be previewed.';
			}
			if (previewIntent === 'save') riskOpen = true;
		};
	};

	function closeDDLPreview() {
		ddlPreview = null;
		ddlPreviewError = '';
		riskOpen = false;
	}

	/** Permanently deletes the schema definition and drops its table with every row. */
	async function deleteSchema() {
		if (!saved?.name) return;
		const name = saved.name;
		const rows = rowCounts[name] ?? 0;
		const ok = await confirm(
			`Delete schema ${name}?`,
			rows > 0
				? `This deletes the definition, its table and all ${rows} ${rows === 1 ? 'row' : 'rows'} in it. It cannot be undone.`
				: 'This deletes the definition and its table. It cannot be undone.',
			{ confirmLabel: 'Delete' },
		);
		if (ok) deleteForm?.requestSubmit();
	}

	const submitDelete: SubmitFunction = () => {
		return async ({ result }) => {
			if (result.type === 'success' && result.data && 'deleted' in result.data) {
				const name = String(result.data.deleted);
				schemas = schemas.filter((s) => s.name !== name);
				open(null);
				toast.success(`Deleted ${name}`);
			} else if (result.type === 'failure') {
				saveError = String((result.data as { error?: string })?.error ?? 'The schema could not be deleted.');
			}
		};
	};

	// Renaming moves the table, so it is its own step with its own form, and
	// only from a saved state: the rename runs before anything else would.
	let renameOpen = $state(false);
	let renameTo = $state('');
	let renaming = $state(false);
	let renameError = $state('');

	function openRename() {
		if (!saved) return;
		renameTo = saved.name;
		renameError = '';
		renameOpen = true;
	}

	const submitRename: SubmitFunction = () => {
		renaming = true;
		renameError = '';
		return async ({ result }) => {
			renaming = false;
			if (result.type === 'success' && result.data && 'saved' in result.data) {
				const from = String((result.data as { from?: string }).from ?? '');
				const stored = withIds(result.data.saved as Schema);
				schemas = schemas.map((s) => (s.name === from ? stored : s));
				open(stored);
				renameOpen = false;
				toast.success(`Renamed ${from} to ${stored.name}`);
				await invalidateAll();
			} else if (result.type === 'failure') {
				renameError = String((result.data as { error?: string })?.error ?? 'The schema could not be renamed.');
			}
		};
	};

	function newSchema() {
		void (async () => {
			if (!(await mayDiscard())) return;
			open({
				name: '', display_name: '', fields: [],
				with_created_at: false, with_updated_at: false,
				with_soft_delete: false, with_localization: false,
			}, false);
			view = 'list';
		})();
	}

	// The table's history: what each save ran and what it queued. Read when
	// the section is opened, so opening a schema costs no extra request.
	const isSuperAdmin = $derived(data.isSuperAdmin === true);
	let historyForm = $state<HTMLFormElement>();
	let applyForm = $state<HTMLFormElement>();
	let historyOpen = $state(false);
	let ddlHistory = $state<{ name: string; entries: HistoryEntry[]; pending: number; limit: number } | null>(null);
	let historyError = $state('');
	let historyLoading = $state(false);
	let applying = $state(false);

	$effect(() => {
		// A different schema's history is not this one's.
		if (ddlHistory && ddlHistory.name !== saved?.name) {
			ddlHistory = null;
			historyError = '';
		}
	});

	$effect(() => {
		if (historyOpen && saved && !ddlHistory && !historyLoading && !historyError) loadHistory();
	});

	function loadHistory() {
		if (!saved || !isSuperAdmin) return;
		historyForm?.requestSubmit();
	}

	const submitHistory: SubmitFunction = () => {
		historyLoading = true;
		historyError = '';
		return async ({ result }) => {
			historyLoading = false;
			if (result.type === 'success' && result.data && 'entries' in result.data) {
				const d = result.data as { name: string; entries: HistoryEntry[]; pending: number; limit: number };
				ddlHistory = { name: d.name, entries: d.entries, pending: d.pending, limit: d.limit };
			} else if (result.type === 'failure') {
				historyError = String((result.data as { error?: string })?.error ?? 'The history could not be read.');
			} else if (result.type === 'error') {
				historyError = 'The admin could not reach the engine.';
			}
		};
	};

	async function applyQueued() {
		if (!saved || !ddlHistory?.pending) return;
		const rows = rowCounts[saved.name] ?? 0;
		const ok = await confirm(
			`Apply ${ddlHistory.pending} queued ${ddlHistory.pending === 1 ? 'change' : 'changes'} to ${saved.name}?`,
			`A queued change is one a save recorded instead of running: a column or table drop, or clearing one tenant's values in a column other tenants keep. The table holds ${rows} ${rows === 1 ? 'row' : 'rows'}, and every tenant that defines ${saved.name} shares it, so the data in a dropped column is gone for all of them. A change whose column a definition uses again is canceled rather than run.`,
			{ confirmLabel: 'Apply' },
		);
		if (ok) applyForm?.requestSubmit();
	}

	const submitApply: SubmitFunction = () => {
		applying = true;
		return async ({ result }) => {
			applying = false;
			if (result.type === 'success' && result.data && 'applied' in result.data) {
				toast.success(appliedMessage(Number(result.data.applied), Number((result.data as { canceled?: number }).canceled ?? 0)));
				loadHistory();
			} else if (result.type === 'failure') {
				historyError = String((result.data as { error?: string })?.error ?? 'The queued changes could not be applied.');
				loadHistory();
			}
		};
	};

	const HISTORY_TONE: Record<HistoryEntry['state'], 'success' | 'warn' | 'danger' | 'neutral'> = {
		applied: 'success',
		pending: 'warn',
		failed: 'danger',
		canceled: 'neutral',
	};
	const HISTORY_WORD: Record<HistoryEntry['state'], string> = {
		applied: 'Applied',
		pending: 'Queued',
		failed: 'Failed',
		canceled: 'Canceled',
	};

	/** Starts a download without leaving the page, so no unsaved-changes prompt runs. */
	function download(href: string) {
		const a = document.createElement('a');
		a.href = href;
		a.download = '';
		document.body.append(a);
		a.click();
		a.remove();
	}

	const transferItems = $derived([
		{ label: 'Export as YAML', icon: Download, onclick: () => download('/admin/schema/export') },
		{ label: 'Export as JSON', icon: Download, onclick: () => download('/admin/schema/export?format=json') },
		...(isSuperAdmin ? [{ label: 'Import', icon: Upload, onclick: openImport }] : []),
	]);

	// Import, in two steps: the engine's plan first, then the run. The file
	// or the paste stays in the form between them, so the second submit sends
	// what the first one checked.
	let importOpen = $state(false);
	let importForm = $state<HTMLFormElement>();
	let importSource = $state<string>('lyeve');
	let importText = $state('');
	let importFileName = $state('');
	let importApply = $state(false);
	let importing = $state(false);
	let importPlan = $state<ImportPlan | null>(null);
	let importNotes = $state<{ schema: string; field?: string; message: string }[]>([]);
	let importRenamed = $state<Record<string, string>>({});
	let importError = $state('');

	const importBlocked = $derived(
		(importPlan?.schemas ?? []).filter((s) => (s.missing?.length ?? 0) > 0).map((s) => s.name),
	);
	const importChanges = $derived((importPlan?.schemas ?? []).filter((s) => s.action !== 'unchanged').length);

	function openImport() {
		importPlan = null;
		importNotes = [];
		importRenamed = {};
		importError = '';
		importApply = false;
		importOpen = true;
	}

	/** Anything edited after the plan was read makes the plan stale. */
	function importEdited() {
		importPlan = null;
		importError = '';
	}

	async function runImport(apply: boolean) {
		importApply = apply;
		// The hidden field has to carry the flag before the form is read.
		await tick();
		importForm?.requestSubmit();
	}

	const submitImport: SubmitFunction = () => {
		importing = true;
		importError = '';
		return async ({ result }) => {
			importing = false;
			if (result.type === 'success' && result.data && 'plan' in result.data) {
				const d = result.data as {
					applied: boolean;
					plan: ImportPlan;
					renamed: Record<string, string>;
					notes: { schema: string; field?: string; message: string }[];
				};
				if (d.applied) {
					const n = d.plan.schemas.filter((x) => x.action !== 'unchanged').length;
					importOpen = false;
					toast.success(n === 1 ? 'Imported one content type' : `Imported ${n} content types`);
					await invalidateAll();
					return;
				}
				importPlan = d.plan;
				importNotes = d.notes;
				importRenamed = d.renamed;
			} else if (result.type === 'failure') {
				const d = (result.data ?? {}) as { error?: string; plan?: ImportPlan | null };
				importError = d.error ?? 'The definitions could not be imported.';
				if (d.plan) importPlan = d.plan;
			} else if (result.type === 'error') {
				importError = 'The admin could not reach the engine. Nothing was imported.';
			}
		};
	};

	/** Toggles a system column the engine manages. Removing one that exists is named at save. */
	function toggleSystemColumn(field: SystemColumn, checked: boolean) {
		if (!selected) return;
		selected[field] = checked;
	}

	// Derived field groupings, updated whenever `selected` changes.
	let topSysFields = $derived(selected?.fields.filter((f) => f.system && !isTimestamp(f)) ?? []);
	let userFields = $derived(selected?.fields.filter((f) => !f.system) ?? []);
	let bottomSysFields = $derived(selected?.fields.filter((f) => f.system && isTimestamp(f)) ?? []);
	let savedTsNames = $derived(new Set(bottomSysFields.map((f) => f.name)));

	// The rail lists every schema in the tenant. A tenant with two hundred of
	// them turns picking one into a scroll, so the list is filterable.
	// A new filter starts the list from the top.
	$effect(() => {
		void schemaFilter;
		shown = PAGE;
	});

	let visibleSchemas = $derived.by(() => {
		const q = schemaFilter.trim().toLowerCase();
		if (!q) return schemas;
		return schemas.filter(
			(s) => s.name.toLowerCase().includes(q) || (s.display_name ?? '').toLowerCase().includes(q),
		);
	});

	/** Whether focus is in a control that owns its own undo. */
	function editingText(): boolean {
		const el = document.activeElement as HTMLElement | null;
		if (!el) return false;
		return el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA';
	}

	function onKey(e: KeyboardEvent) {
		if (!(e.ctrlKey || e.metaKey) || !selected) return;
		const key = e.key.toLowerCase();
		if (key === 's') {
			e.preventDefault();
			requestSave();
		} else if (!editingText() && key === 'z') {
			e.preventDefault();
			if (e.shiftKey) redo();
			else undo();
		} else if (!editingText() && key === 'y') {
			e.preventDefault();
			redo();
		}
	}

	function beforeUnload(e: BeforeUnloadEvent) {
		if (dirty) e.preventDefault();
	}

	// A link out of the page asks first while there are edits. The navigation
	// is canceled, the question asked, and the same destination taken again
	// once the answer is yes.
	let leaving = false;
	beforeNavigate(({ cancel, to, type }) => {
		if (leaving || !dirty || type === 'leave' || !to) return;
		cancel();
		void (async () => {
			if (!(await mayDiscard())) return;
			leaving = true;
			await goto(to.url);
			leaving = false;
		})();
	});
</script>


<PageTitle title="Schema builder" />

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

<svelte:window onkeydown={onKey} onbeforeunload={beforeUnload} />

<!-- The editor for one schema. The list view shows it beside the rail and the
     canvas in a panel beside the diagram, so both edit the same way. -->
{#snippet editorBody(schema: Schema)}
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
							onclick={openRename}
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
					<div class="flex flex-wrap gap-4">
						{#each TRANSPORTS as t (t.key)}
							<Select
								id="transport-{t.key}"
								label={t.label}
								hint={t.hint}
								options={TRANSPORT_MODE_OPTIONS}
								value={transportMode(schema, t.key)}
								onvaluechange={(v) => setTransport(t.key, v as TransportMode)}
								class="w-48 shrink-0"
							/>
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
			{@const plan = selected ? planRelation(selected, field, schemas) : null}
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
							onclick={() => removeField(rowId)}
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
						<div class="grid gap-3 sm:grid-cols-2">
							<Select
								id="relation-type-{rowId}"
								label="Relation"
								error={problemAt(`relation-type-${rowId}`)}
								options={RELATION_OPTIONS}
								value={field.relation_type ?? 'belongs_to'}
								onvaluechange={(v) => {
									field.relation_type = v as RelationType;
									dropInertFlags(field);
								}}
							/>
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
		<Button variant="outline" size="sm" class="border-dashed" onclick={addField}>
			<Plus size={ICON.sm} /> Add field
		</Button>
		<Button variant="outline" size="sm" class="border-dashed" onclick={() => addRelation()}>
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
								<Badge tone={methodTone[route.method]} class="font-mono">{route.method}</Badge>
								<code class="min-w-0 flex-1 truncate font-mono text-xs text-fg">{route.path}</code>
								<span class="text-xs text-faint">{route.summary}</span>
								<button
									type="button"
									onclick={() => copyRequest(preview)}
									class="relative hit-area flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-faint transition-colors hover:bg-surface-2 hover:text-fg"
									title="Copy a curl request"
									aria-label="Copy a curl request for {route.method} {route.path}"
								>
									{#if copiedRequest === preview}
										<Check size={ICON.xs} class="text-success" />
									{:else}
										<Copy size={ICON.xs} />
									{/if}
								</button>
							</div>
						</li>
					{/each}
				</ul>
			</div>
		</Collapsible>

		{#if isSuperAdmin}
			<!-- What each save ran against the table, and the drops it queued
			     instead of running. Read when the section opens. -->
			<Collapsible label="History" icon={History} bind:open={historyOpen} badge={ddlHistory?.pending ? `${ddlHistory.pending} queued` : undefined}>
				<div class="flex flex-col gap-3" data-testid="schema-history">
					{#if historyError}
						<Alert tone="danger">{historyError}</Alert>
					{/if}
					{#if historyLoading && !ddlHistory}
						<p class="text-sm text-muted">Reading the history.</p>
					{:else if ddlHistory}
						{#if ddlHistory.pending > 0}
							<Alert tone="warn" title="{ddlHistory.pending} queued {ddlHistory.pending === 1 ? 'change' : 'changes'}">
								{#snippet children()}
									<div class="flex flex-wrap items-center justify-between gap-3">
										<span>A save queued these changes instead of running them. The columns and their data stay in the table until they are applied.</span>
										<Button variant="danger" size="sm" onclick={applyQueued} loading={applying}>Apply</Button>
									</div>
								{/snippet}
							</Alert>
						{/if}
						{#if ddlHistory.entries.length === 0}
							<p class="text-sm text-muted">Nothing is recorded for this table yet.</p>
						{:else}
							<ol class="flex flex-col gap-2">
								{#each ddlHistory.entries as e, i (e.version + ':' + i)}
									<li class="rounded-lg border border-line bg-surface p-3">
										<div class="flex flex-wrap items-center gap-2">
											<Badge tone={HISTORY_TONE[e.state]} dot>{HISTORY_WORD[e.state]}</Badge>
											<span class="text-sm text-fg">{e.description}</span>
											<span class="ms-auto text-xs text-faint">
												v{e.version} ·
												{formatDateTime(e.canceled_at ?? e.applied_at ?? e.created_at)}
												{#if e.tenant}· tenant {e.tenant}{/if}
												{#if e.applied_by}· {e.applied_by}{/if}
											</span>
										</div>
										<details class="mt-2">
											<summary class="cursor-pointer text-xs text-muted transition-colors hover:text-fg">SQL</summary>
											<pre class="mt-1 overflow-x-auto rounded bg-surface-2 p-3 font-mono text-xs whitespace-pre-wrap text-fg">{e.up_sql}</pre>
											{#if e.down_sql}
												<p class="mt-2 text-xs text-muted">Undo</p>
												<pre class="mt-1 overflow-x-auto rounded bg-surface-2/60 p-3 font-mono text-xs whitespace-pre-wrap text-muted">{e.down_sql}</pre>
											{/if}
										</details>
									</li>
								{/each}
							</ol>
							{#if ddlHistory.entries.length >= ddlHistory.limit}
								<p class="text-xs text-faint">The newest {ddlHistory.limit} statements.</p>
							{/if}
						{/if}
					{/if}
				</div>
			</Collapsible>
		{/if}
	{/if}
	</div>
	</div>
{/snippet}

<!-- The toolbar is the header, as it is in the flow editor: the shell's title
     row is not drawn, so the list and the fields start one row below the
     frame. The h1 stays, for assistive technology. -->
<PageShell title="Schema builder" fill titleHidden>
	<div class="flex min-h-0 flex-1 flex-col overflow-hidden">
		{#if selected}
			<form method="POST" action="?/save" use:enhance={submitSave} bind:this={saveForm} class="hidden">
				<input type="hidden" name="schema" value={schemaJSON} />
				<input type="hidden" name="original" value={saved?.name ?? ''} />
				<input type="hidden" name="renames" value={renamesJSON} />
			</form>
			<form method="POST" action="?/preview" use:enhance={submitPreview} bind:this={previewForm} class="hidden">
				<input type="hidden" name="schema" value={schemaJSON} />
				<input type="hidden" name="intent" value={previewIntent} />
				<input type="hidden" name="renames" value={renamesJSON} />
			</form>
			<form method="POST" action="?/delete" use:enhance={submitDelete} bind:this={deleteForm} class="hidden">
				<input type="hidden" name="name" value={saved?.name ?? ''} />
			</form>
			{#if isSuperAdmin}
				<form method="POST" action="?/history" use:enhance={submitHistory} bind:this={historyForm} class="hidden">
					<input type="hidden" name="name" value={saved?.name ?? ''} />
				</form>
				<form method="POST" action="?/applyPending" use:enhance={submitApply} bind:this={applyForm} class="hidden">
					<input type="hidden" name="name" value={saved?.name ?? ''} />
				</form>
			{/if}
		{/if}

		<div class="shrink-0 border-b border-line px-3 py-2">
			<Toolbar label="Schema builder">
				<!-- The list editor is the whole builder. The switch is drawn only
				     when the build carries a diagram to switch to. -->
				{#if hasSchemaCanvas}
					<SegmentedControl
						label="View"
						labelHidden
						bind:value={view}
						options={[
							{ value: 'list', label: 'List', icon: List },
							{ value: 'canvas', label: 'Canvas', icon: Network },
						]}
					/>
				{/if}
				{#if canWrite}
					<!-- The one place a schema is started from. -->
					<Button variant="secondary" size="sm" onclick={newSchema}>
						<Plus size={ICON.sm} /> New schema
					</Button>
					{#if hasPresets}
						<Button variant="ghost" size="sm" onclick={() => (showPresets = true)}>
							<LayoutTemplate size={ICON.sm} /> Presets
						</Button>
					{/if}
					<!-- Moving content types between instances. Export is a read an admin
					     may make. Import runs DDL, so the engine holds it to super_admin. -->
					<Dropdown items={transferItems}>
						{#snippet trigger({ open, toggle })}
							<Button variant="ghost" size="sm" aria-label="Import and export" aria-haspopup="menu" aria-expanded={open} onclick={toggle}>
								<Ellipsis size={ICON.sm} />
							</Button>
						{/snippet}
					</Dropdown>
				{/if}
				{#if selected}
					<span class="flex min-w-0 items-baseline gap-2" data-testid="schema-status">
						<span class="truncate text-sm font-medium text-fg">
							{selected.display_name || selected.name || 'New schema'}
						</span>
						{#if selected.name}
							<code class="truncate font-mono text-xs text-faint">{tableName(selected.name)}</code>
						{/if}
						{#if dirty}
							<Badge tone="warn" dot>{isNewSchema ? 'Not saved yet' : 'Unsaved changes'}</Badge>
						{:else}
							<Badge tone="success" dot>Saved</Badge>
						{/if}
					</span>
					<ProblemsMenu
						id="schema-problems"
						title="Fix these before saving"
						problems={problemItems}
						bind:open={showProblems}
						onjump={(p) => {
							const target = problemItems.find((x) => x.key === p.key)?.target;
							if (target) void focusProblem(target);
						}}
					/>
				{/if}
				{#snippet actions()}
					{#if selected && canWrite}
						<ButtonGroup>
							<Button variant="ghost" size="sm" disabled={!historyState.canUndo} onclick={undo} aria-label="Undo" hint="Undo (Ctrl+Z)">
								<Undo2 size={ICON.sm} />
							</Button>
							<Button variant="ghost" size="sm" disabled={!historyState.canRedo} onclick={redo} aria-label="Redo" hint="Redo (Ctrl+Shift+Z)">
								<Redo2 size={ICON.sm} />
							</Button>
						</ButtonGroup>
						<Button
							variant="secondary"
							size="sm"
							onclick={requestPreview}
							loading={previewing && previewIntent === 'look'}
							disabled={!selected.name}
							hint="The DDL a save would run"
						>
							<Eye size={ICON.sm} /> Preview DDL
						</Button>
						{#if saved}
							<Button variant="ghost" size="sm" class="text-danger" onclick={deleteSchema} aria-label="Delete schema {saved.name}" hint="Delete the schema and its table">
								<Trash2 size={ICON.sm} />
							</Button>
						{/if}
						<Button
							variant="primary"
							size="sm"
							onclick={requestSave}
							disabled={!dirty || problems.length > 0}
							loading={saving || (previewing && previewIntent === 'save')}
							hint={!dirty ? 'No unsaved changes' : problems.length > 0 ? 'Fix the problems first' : 'Save (Ctrl+S)'}
						>
							<Save size={ICON.sm} /> Save
						</Button>
					{/if}
				{/snippet}
			</Toolbar>
		</div>

		{#if data.loadError}
			<div class="shrink-0 px-3 pt-3">
				<Alert tone="danger" title="The schemas could not be read">
					{#snippet children()}The engine did not answer. This is not a report that there are none. Reload once it does.{/snippet}
				</Alert>
			</div>
		{/if}
		{#if !canWrite}
			<div class="shrink-0 px-3 pt-3">
				<Alert tone="brand">Your role reads schemas. Changing one takes admin or super_admin.</Alert>
			</div>
		{/if}
		{#if presetCreated}
			<div class="shrink-0 px-3 pt-3">
				<Alert tone="success" title="Preset created" autoDismiss>
					{#snippet children()}
						{presetCreated.length === 1 ? 'One schema is' : `${presetCreated.length} schemas are`} in the list now: {presetCreated.join(', ')}. Pick one to see its fields.
					{/snippet}
				</Alert>
			</div>
		{/if}

		<!-- One column below lg: the list on top and the editor under it, each
		     scrolling on its own. The list keeps the whole height until a schema is
		     picked or the canvas is shown, then gives three fifths of it to the
		     pane. Side by side, a 400px screen would give the editor 112px, and the
		     shell's own 224px sidebar arrives at md: and takes the room out of the
		     editor, so the pair docks only from lg:, where there is room for both. -->
		<div class="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
			<ResizableAside
				storageKey="lyeve-schema-list"
				label="Content types"
				side="start"
				width={288}
				min={200}
				max={480}
				breakpoint="lg"
				collapsible
				class={selected || view === 'canvas' ? 'max-h-2/5 shrink-0' : 'flex-1'}
				testId="schema-list"
			>
				{#snippet meta()}
					<span class="text-xs tabular-nums text-faint">{schemas.length}</span>
				{/snippet}

				<!-- The filter sits on the list it narrows. -->
				{#if schemas.length > 1}
					<div class="px-3 pt-3">
						<label for="schema-filter" class="sr-only">Filter schemas</label>
						<SearchInput id="schema-filter" bind:value={schemaFilter} placeholder="Filter schemas" />
					</div>
				{/if}
				<div class="space-y-1 p-3">
					{#each visibleSchemas.slice(0, shown) as s (s.name)}
						{@const relations = s.fields.filter((f) => f.field_type === 'relation').length}
						{@const rows = rowCounts[s.name]}
						<!-- Named by the schema alone. The two lines under the pointer are
						     the table it writes and how big it is, and reading all of that
						     out as the control's name says more about the row than about
						     what pressing it does. -->
						<button
							type="button"
							aria-label={s.display_name || s.name}
							aria-current={saved?.name === s.name ? 'true' : undefined}
							onclick={() => selectSchema(s)}
							class="w-full rounded-lg px-3 py-2 text-left transition-colors
								{saved?.name === s.name ? 'bg-line text-fg' : 'text-muted hover:bg-surface-2 hover:text-fg'}"
						>
							<span class="flex items-baseline justify-between gap-2">
								<span class="truncate text-sm font-medium">{s.display_name || s.name}</span>
								<span class="shrink-0 text-xs tabular-nums text-faint">
									{s.fields.length}
									{s.fields.length === 1 ? 'field' : 'fields'}
								</span>
							</span>
							<span class="mt-0.5 flex items-center gap-2 truncate text-xs text-faint">
								<span class="truncate font-mono">{tableName(s.name)}</span>
								{#if relations > 0}
									<span class="shrink-0">{relations} rel</span>
								{/if}
								{#if rows !== undefined}
									<span class="shrink-0 tabular-nums">{rows} {rows === 1 ? 'row' : 'rows'}</span>
								{/if}
							</span>
						</button>
					{/each}
					{#if visibleSchemas.length === 0 && schemas.length > 0}
						<p class="px-3 py-2 text-sm text-muted">No schema matches that filter.</p>
					{/if}
					{#if visibleSchemas.length > shown}
						<Button variant="ghost" size="sm" class="w-full" onclick={() => (shown += PAGE)}>
							Show {Math.min(PAGE, visibleSchemas.length - shown)} more of {visibleSchemas.length - shown}
						</Button>
					{/if}
				</div>
			</ResizableAside>

			{#if view === 'canvas' && SchemaCanvas && !canvasLicensed}
				<div class="flex min-h-0 min-w-0 flex-1 items-center justify-center p-6" data-testid="schema-canvas-locked">
					<NotEnabled
						title="Schema canvas"
						description="The canvas draws every content type and its relations as a diagram you edit in place, and keeps the layout your team arranges. This instance's license does not include it. The list editor does everything else."
					/>
				</div>
			{:else if view === 'canvas' && SchemaCanvas}
				<!-- The diagram and, once a node is picked, its editor beside it: the
				     same editor the list view shows, so a schema is edited the same way
				     from either. Below lg: the panel stacks under the diagram. -->
				<div class="flex min-h-0 min-w-0 flex-1 flex-col lg:flex-row">
					<div class="relative min-h-0 min-w-0 flex-1">
						<SchemaCanvas
							bind:this={schemaCanvas}
							{schemas}
							{selected}
							onselect={selectSchema}
							{rowCounts}
							savedPositions={data.canvas?.positions}
							onpositions={canWrite ? saveLayout : undefined}
							onaddfield={canWrite
								? async (name: string) => {
										const s = schemas.find((x) => x.name === name);
										if (!s) return;
										await selectSchema(s);
										if (saved?.name === name) addField();
									}
								: undefined}
							onrelate={canWrite
								? async (from: string, to: string | null) => {
										const s = schemas.find((x) => x.name === from);
										if (!s) return;
										await selectSchema(s);
										if (saved?.name === from) addRelation(to ?? undefined);
									}
								: undefined}
						/>
					</div>
					{#if selected}
						<ResizableAside
							storageKey="lyeve-schema-canvas-panel"
							bind:open={canvasPanelOpen}
							label="Schema"
							side="end"
							width={600}
							min={420}
							max={880}
							breakpoint="lg"
							collapsible
							class="max-h-1/2 shrink-0 lg:max-h-none"
							testId="schema-canvas-panel"
						>
							{#snippet meta()}
								<span class="truncate font-mono text-xs text-faint">{selected?.name || 'new'}</span>
							{/snippet}
							<div class="flex min-h-0 flex-col">
								{@render editorBody(selected)}
							</div>
						</ResizableAside>
					{/if}
				</div>
			{:else}
				<div class="flex min-h-0 min-w-0 flex-1 flex-col">
					{#if selected}
						{@render editorBody(selected)}
					{:else if schemas.length === 0 && !data.loadError}
						<!-- The offer the flow editor makes from its empty canvas: a way in
						     that is not a blank form. A preset is a set of content types
						     the engine ships. New schema in the toolbar stays the other door. -->
						<div class="flex h-full items-center justify-center">
							<EmptyState
								title="No schemas yet"
								description={canWrite
									? hasPresets
										? 'Start one with New schema in the toolbar, or create a ready-made set from a preset.'
										: 'Start one with New schema in the toolbar.'
									: 'An admin creates the first one.'}
							>
								{#snippet iconSnippet()}
									<Table2 size={ICON.lg} />
								{/snippet}
								{#snippet action()}
									{#if hasPresets && canWrite}
										<Button variant="secondary" onclick={() => (showPresets = true)}>
											<LayoutTemplate size={ICON.sm} />
											Use a preset
										</Button>
									{/if}
								{/snippet}
							</EmptyState>
						</div>
					{:else if schemas.length > 0}
						<div class="flex h-full items-center justify-center">
							<EmptyState
								title="No schema selected"
								description={canWrite ? 'Pick one from the list, or start one with New schema in the toolbar.' : 'Pick one from the list.'}
							>
								{#snippet iconSnippet()}
									<Table2 size={ICON.lg} />
								{/snippet}
							</EmptyState>
						</div>
					{/if}
				</div>
			{/if}
		</div>
	</div>
</PageShell>

<form method="POST" action="?/saveLayout" use:enhance={layoutSubmit} bind:this={layoutForm} class="hidden">
	<input type="hidden" name="positions" value={layoutJSON} />
</form>

<!-- One form per card, so a card creates what it names and nothing has to be
     picked first. The refusal an engine sends (a schema of that name exists)
     is shown under the card it belongs to, with the drawer still open. -->
<Drawer bind:open={showPresets} title="Use a preset" size="lg">
	<div class="flex flex-col gap-4">
		<p class="text-sm text-muted">A preset creates a set of content types together, with their fields and relations. Each is a schema like any other once it exists.</p>
		{#if data.canWrite}
			{#if canSavePresets}
				<Collapsible label="Save a preset from a URL or a file">
					<form method="POST" action="?/savePreset" enctype="multipart/form-data" use:enhance={presetSave} class="flex flex-col gap-4 pt-2">
						<p class="text-sm text-muted">A preset document is JSON or YAML with an id, a name, a description and its schemas, each the body a new schema takes. Saved, it is listed here beside the built-in ones. Saving the same id again replaces it, so reading the URL again refreshes it.</p>
						<Input id="preset-url" name="url" type="url" label="URL" placeholder="https://example.com/presets/blog.json" hint="Read over http or https. Private and loopback addresses are refused." />
						<FileInput id="preset-file" name="file" label="Or a file" accept=".json,.yaml,.yml,application/json,application/yaml" />
						<Textarea id="preset-document" name="document" label="Or paste the document" rows={6} class="[&_textarea]:text-xs" mono />
						{#if presetSaveError}
							<Alert tone="danger">{presetSaveError}</Alert>
						{/if}
						<div class="flex justify-end">
							<Button variant="primary" type="submit" loading={presetSaving}>Save</Button>
						</div>
					</form>
				</Collapsible>
			{:else}
				<div class="flex flex-wrap items-center gap-2 text-sm text-muted" data-testid="preset-save-locked">
					<span>Saving your own presets from a URL or a file is not included in this instance's license. The presets below are always available.</span>
					<NotEnabled title="Custom presets" compact />
				</div>
			{/if}
		{/if}
		{#if data.presetsError}
			<Alert tone="danger" title="Presets could not be loaded">
				{#snippet children()}{data.presetsError} Reload once the engine answers again.{/snippet}
			</Alert>
		{:else if (data.presets ?? []).length === 0}
			<EmptyState title="No presets" description="The engine offered none. Start from New schema instead." />
		{:else}
			<div class="grid gap-3 sm:grid-cols-2" data-testid="preset-gallery">
				{#each data.presets as preset (preset.id)}
					<Card heading={preset.name} headingLevel={3} description={preset.description}>
						{#if preset.source === 'saved'}
							<div class="mb-2 flex flex-wrap items-center gap-2">
								<Badge tone="brand" size="sm">Saved</Badge>
								{#if preset.source_url}
									<span class="min-w-0 flex-1 truncate text-xs text-faint" title={preset.source_url}>{preset.source_url}</span>
								{/if}
								{#if data.canWrite}
									<Button variant="ghost" size="sm" class="ms-auto" aria-label="Delete the preset {preset.name}" onclick={() => void deletePreset(preset.id, preset.name)}>
										<Trash2 size={ICON.sm} class="text-danger" />
									</Button>
								{/if}
							</div>
						{/if}
						<ul class="flex flex-wrap gap-1.5" aria-label="Schemas {preset.name} creates">
							{#each preset.schemas as schema (schema.name)}
								<li>
									<code class="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-muted">{schema.name}</code>
								</li>
							{/each}
						</ul>
						{#if presetError && presetError.preset === preset.id}
							<Alert tone="danger" class="mt-3">{presetError.error}</Alert>
						{/if}
						{#snippet footer()}
							<form
								method="POST"
								action="?/preset"
								use:enhance={presetSubmit(preset.id)}
							>
								<input type="hidden" name="id" value={preset.id} />
								<Button
									variant="primary"
									type="submit"
									loading={presetPending === preset.id}
									disabled={presetPending !== '' && presetPending !== preset.id}
								>
									Create
								</Button>
							</form>
						{/snippet}
					</Card>
				{/each}
			</div>
		{/if}
	</div>
	<form method="POST" action="?/deletePreset" use:enhance bind:this={presetDeleteForm} class="hidden">
		<input type="hidden" name="id" value={presetDeleteId} />
	</form>
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (showPresets = false)}>Cancel</Button>
	{/snippet}
</Drawer>

<!-- Import in two steps: Check asks the engine for its plan and shows it, and
     Import runs that plan. Editing the file or the source after a check throws
     the plan away, so what runs is what was read. -->
<Drawer bind:open={importOpen} title="Import content types">
	<form
		method="POST"
		action="?/import"
		id="schema-import-form"
		enctype="multipart/form-data"
		use:enhance={submitImport}
		bind:this={importForm}
		class="flex flex-col gap-4"
	>
		<input type="hidden" name="apply" value={importApply ? 'true' : 'false'} />
		<Select
			id="import-source"
			name="source"
			label="Where the definitions come from"
			options={IMPORT_SOURCES.map((o) => ({ value: o.value, label: o.label }))}
			value={importSource}
			onvaluechange={(v) => {
				importSource = v;
				importEdited();
			}}
		/>
		<FileInput
			id="import-file"
			name="file"
			label="Definition file"
			accept=".json,.yaml,.yml,application/json,application/yaml"
			hint="Up to 4 MB. A LyEve export is YAML or JSON. The others are the file that system writes."
			onchange={(files) => {
				importFileName = files?.[0]?.name ?? '';
				importEdited();
			}}
		/>
		<Textarea
			id="import-text"
			name="text"
			label="Or paste the definitions"
			rows={8}
			bind:value={importText}
			oninput={importEdited}
			placeholder={'schemas:\n  - name: articles\n    fields: []'}
			mono
		/>
		{#if importError}
			<Alert tone="danger">{importError}</Alert>
		{/if}
		{#if importPlan}
			<div class="flex flex-col gap-3" data-testid="import-plan">
				<SectionHeading level={3}>What importing does</SectionHeading>
				{#if importChanges === 0}
					<p class="text-sm text-muted">Every content type in the file is already here as written. Importing would change nothing.</p>
				{/if}
				{#if importBlocked.length > 0}
					<Alert tone="danger" title="Some content types point at ones that are not here">
						{#snippet children()}
							{importBlocked.join(', ')} {importBlocked.length === 1 ? 'depends' : 'depend'} on a schema neither the file nor this instance has. Add it to the file, or create it first.
						{/snippet}
					</Alert>
				{/if}
				<ul class="flex flex-col gap-2">
					{#each importPlan.schemas as p (p.name)}
						<li class="rounded-lg border border-line bg-surface p-3">
							<div class="flex flex-wrap items-center gap-2">
								<span class="font-mono text-sm text-fg">{p.name}</span>
								<Badge tone={p.action === 'create' ? 'success' : p.action === 'update' ? 'warn' : 'neutral'}>
									{p.action === 'create' ? 'Creates' : p.action === 'update' ? 'Changes' : 'Unchanged'}
								</Badge>
								{#if p.missing?.length}
									<span class="text-xs text-danger">needs {p.missing.join(', ')}</span>
								{/if}
							</div>
							{#if p.ddl?.length}
								<details class="mt-2">
									<summary class="cursor-pointer text-xs text-muted transition-colors hover:text-fg">
										{p.ddl.length} {p.ddl.length === 1 ? 'statement' : 'statements'}
									</summary>
									<pre class="mt-1 overflow-x-auto rounded bg-surface-2 p-3 font-mono text-xs whitespace-pre-wrap text-fg">{p.ddl.join('\n\n')}</pre>
								</details>
							{/if}
						</li>
					{/each}
				</ul>
				{#if Object.keys(importRenamed).length > 0}
					<div>
						<p class="mb-1 text-xs text-muted">Renamed to fit the engine's names</p>
						<ul class="space-y-0.5 text-xs text-muted">
							{#each Object.entries(importRenamed) as [from, to] (from)}
								<li><span class="font-mono">{from}</span> to <span class="font-mono">{to}</span></li>
							{/each}
						</ul>
					</div>
				{/if}
				{#if importNotes.length > 0}
					<div>
						<p class="mb-1 text-xs text-muted">Read before importing</p>
						<ul class="space-y-0.5 text-xs text-muted">
							{#each importNotes as n, i (i)}
								<li><span class="font-mono">{n.schema}{n.field ? `.${n.field}` : ''}</span>: {n.message}</li>
							{/each}
						</ul>
					</div>
				{/if}
			</div>
		{/if}
	</form>
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (importOpen = false)}>Cancel</Button>
		{#if importPlan && importChanges > 0 && importBlocked.length === 0}
			<Button variant="primary" loading={importing && importApply} onclick={() => runImport(true)}>Import</Button>
		{:else}
			<Button
				variant="primary"
				loading={importing && !importApply}
				disabled={!importText.trim() && !importFileName}
				onclick={() => runImport(false)}
			>
				Check
			</Button>
		{/if}
	{/snippet}
</Drawer>

<!-- The save that moves data asks first, with what it moves and how much. -->
{#if riskOpen && ddlPreview !== null}
	{@const statements = ddlPreview}
	<Modal open size="lg" title="This save changes columns that hold data" onclose={closeDDLPreview}>
		<div class="flex flex-col gap-4" data-testid="save-risk">
			<Alert tone={change.drops.length + change.systemDrops.length > 0 ? 'danger' : 'warn'}>
				{#snippet children()}
					{saved?.name ?? 'This table'} holds {rowsAtRisk} {rowsAtRisk === 1 ? 'row' : 'rows'}.
					<ul class="mt-1 space-y-0.5">
						{#each change.renames as r (r.from)}
							<li>Renames <span class="font-mono">{r.from}</span> to <span class="font-mono">{r.to}</span>. The data moves with it.</li>
						{/each}
						{#each change.retypes as r (r.name)}
							<li>Changes <span class="font-mono">{r.name}</span> from {r.from} to {r.to}. A value that does not convert is lost.</li>
						{/each}
						{#each [...change.drops, ...change.systemDrops] as name (name)}
							<li>Removes <span class="font-mono">{name}</span> from the definition. The column and its data stay in the table until the queued change is applied from History. When another tenant defines the same field, the column stays and only this tenant's values are cleared.</li>
						{/each}
					</ul>
				{/snippet}
			</Alert>
			{#if ddlPreviewError}
				<Alert tone="danger">{ddlPreviewError}</Alert>
			{:else if statements.length === 0}
				<p class="text-sm text-muted">
					{change.renames.length > 0 ? 'Besides the renames, the table already matches this definition.' : 'The table already matches this definition.'}
				</p>
			{:else}
				{#if change.renames.length > 0}
					<p class="text-sm text-muted">The renames run first. Then:</p>
				{/if}
				<div class="flex flex-col gap-3">
					{#each statements as stmt, i (stmt.description + i)}
						<div>
							<p class="mb-1 text-xs text-muted">{i + 1}. {stmt.description}</p>
							<pre class="overflow-x-auto rounded bg-surface-2 p-3 font-mono text-xs whitespace-pre-wrap text-fg">{stmt.sql}</pre>
						</div>
					{/each}
				</div>
			{/if}
		</div>
		{#snippet footer()}
			<Button variant="secondary" onclick={closeDDLPreview}>Cancel</Button>
			<Button
				variant={change.drops.length + change.systemDrops.length > 0 ? 'danger' : 'primary'}
				loading={saving}
				disabled={Boolean(ddlPreviewError)}
				onclick={() => saveForm?.requestSubmit()}
			>
				Save
			</Button>
		{/snippet}
	</Modal>
{:else if ddlPreview !== null}
	{@const statements = ddlPreview}
	<Modal open size="lg" title="Preview DDL" onclose={closeDDLPreview}>
		{#if ddlPreviewError}
			<Alert tone="danger">{ddlPreviewError}</Alert>
		{:else if statements.length === 0}
			<p class="text-sm text-muted">No DDL changes. The table already matches this definition.</p>
		{:else}
			<div class="flex flex-col gap-4">
				{#each statements as stmt, i (stmt.description + i)}
					<div>
						<p class="mb-1 text-xs text-muted">{i + 1}. {stmt.description}</p>
						<pre class="overflow-x-auto rounded bg-surface-2 p-3 font-mono text-xs whitespace-pre-wrap text-fg">{stmt.sql}</pre>
						{#if stmt.down_sql}
							<details class="mt-1">
								<summary class="cursor-pointer text-xs text-faint transition-colors hover:text-muted">
									Down SQL
								</summary>
								<pre class="mt-1 overflow-x-auto rounded bg-surface-2/60 p-3 font-mono text-xs whitespace-pre-wrap text-muted">{stmt.down_sql}</pre>
							</details>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
		{#snippet footer()}
			<Button variant="secondary" onclick={closeDDLPreview}>Close</Button>
		{/snippet}
	</Modal>
{/if}

<!-- A one-field prompt: the new machine name. -->
<Modal bind:open={renameOpen} size="sm" title="Rename {saved?.name ?? 'schema'}">
	<form method="POST" action="?/rename" use:enhance={submitRename} id="schema-rename" class="flex flex-col gap-3">
		<input type="hidden" name="from" value={saved?.name ?? ''} />
		<Input
			id="schema-rename-to"
			name="to"
			label="New machine name"
			bind:value={renameTo}
			hint="The table and the API path move. Every row comes with them."
			error={renameError || undefined}
			mono
		/>
	</form>
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (renameOpen = false)}>Cancel</Button>
		<Button
			variant="primary"
			type="submit"
			form="schema-rename"
			loading={renaming}
			disabled={!renameTo.trim() || renameTo.trim() === saved?.name}
		>
			Rename
		</Button>
	{/snippet}
</Modal>
