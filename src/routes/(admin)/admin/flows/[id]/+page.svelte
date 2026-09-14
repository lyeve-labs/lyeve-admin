<script lang="ts">
	import PageTitle from '$lib/components/PageTitle.svelte';
	import {
		Alert,
		Badge,
		Collapsible,
		Button,
		ButtonGroup,
		Card,
		CopyButton,
		Dropdown,
		EmptyState,
		FileInput,
		Input,
		Kbd,
		Drawer,
		Modal,
		PageShell,
		SectionHeading,
		SegmentedControl,
		Select,
		Table,
		Textarea,
		Toggle,
		Toolbar,
		Tooltip,
		confirm,
		toast,
	} from '@lyeve-labs/ui-kit';
	import {
		ArrowLeft,
		Ban,
		BookOpen,
		Database,
		Download,
		Ellipsis,
		Expand,
		FlaskConical,
		Keyboard,
		LayoutGrid,
		LayoutTemplate,
		Lock,
		Trash2,
		PanelLeft,
		PanelRight,
		Play,
		Redo2,
		Rocket,
		Save,
		Shrink,
		Undo2,
		Upload,
		Variable,
		WandSparkles,
		Workflow,
	} from '@lucide/svelte';
	import { page } from '$app/state';
	import { listBack } from '$lib/back';
	import { fromFlow } from '$lib/flow/back';
	import { enhance } from '$app/forms';
	import { beforeNavigate, goto } from '$app/navigation';
	import { createClient } from '@lyeve-labs/client';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { ActionData, PageData } from './$types';
	import { FlowCanvas, hasFlowCanvas } from '$lib/canvas/flow';
	import type { FlowCanvasApi } from '$lib/canvas/contract';
	import NodePalette from '$lib/components/flow/NodePalette.svelte';
	import FlowInspector from '$lib/components/flow/FlowInspector.svelte';
	import EditorDrawer from '$lib/components/flow/EditorDrawer.svelte';
	import SidePanel from '$lib/components/flow/SidePanel.svelte';
	import RunViewer from '$lib/components/flow/RunViewer.svelte';
	import FlowGuide from '$lib/components/flow/FlowGuide.svelte';
	import AssistantPanel from '$lib/components/flow/AssistantPanel.svelte';
	import NotEnabled from '$lib/components/NotEnabled.svelte';
	import { useInstance } from '$lib/instance.svelte';
	import { csrfHeaders } from '$lib/api/csrf';
	import { submitter } from '$lib/forms.svelte';
	import type { TablesState } from '$lib/components/flow/TablesPanel.svelte';
	import {
		exportFlow,
		introspectDatasource,
		testFlow,
		validateFlow,
		type FlowRun,
		type FlowTemplate,
		type ValidationResult,
	} from '$lib/api/flows';
	import { cleanJSON, cloneDefinition, nodeById, normalizeDefinition, specFor } from '$lib/flow/graph';
	import type { AssistantAnswer, AssistantDraft, AssistantStatus } from '$lib/flow/assistant';
	import type { AssistProblem } from '$lib/api/assist';
	import { emptyDefinition, type FlowDefinition, type FlowStatus, type RefusalNotice, type Selection } from '$lib/flow/types';
	import { tick, untrack } from 'svelte';
	import { formatDuration } from '$lib/flow/time';
	import { defaultTriggerJSON, statusTone, triggerLabel } from '$lib/flow/triggers';
	import { blockedText, isBlockedMessage, missingPluginOf } from '$lib/flow/blocked';
	import { flowGrants } from '$lib/flow/permissions';
	import { draftIsLive, writeButtons } from '$lib/flow/publish';
	import { describeError } from '$lib/flow/problems';
	import ProblemsMenu, { type ProblemItem } from '$lib/components/ProblemsMenu.svelte';
	import { validationErrors, type ValidationError } from '$lib/api/flows';
	import { formatDateTime, relativeTime } from '$lib/format';
	import { useShell } from '$lib/shell.svelte';
	import { readFocus, writeFocus } from '$lib/flow/prefs';
	import { ICON } from '$lib/icon';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const submit = submitter(() => (showImport = false));
	// The list's filter rides on the row link, so the way back lands on the
	// same slice of Flows the reader opened this one from.
	const back = $derived(listBack('/admin/flows', 'Flows', page.url, ['status', 'q']));

	// The shell shows why the page is unavailable while the flow plugin does
	// not run. A plugin that runs and refuses its routes is said here.
	const enabled = $derived(!data.locked);

	// What the caller's roles grant on this flow, as the plugin carries it
	// on the flow. A control the role cannot use is not drawn. The engine
	// still decides and its 403 renders inline. Update covers save and
	// import. Activate covers publish, disable, rollback and test.
	const can = $derived(flowGrants(data.flow?.actions));

	// The 402 the plugin answered, when the last action was one. Read
	// through the type because the action data is a union of every
	// action's answer and the key is optional on all of them.
	const refusal = $derived(form && 'refusal' in form && form.refusal ? (form.refusal as RefusalNotice) : null);
	const instance = useInstance();
	const enableLink = $derived(instance.upgradeLink());

	// The page owns the definition. The canvas and the inspector both edit it
	// and the save action posts it. Nothing else holds a copy. It is seeded
	// from the load once, and reseeded only by an action that moved the draft
	// on the server (a rollback, an import): a re-run load never replaces
	// what the reader is editing underneath them.
	const initial = untrack(() => data.flow);
	let definition = $state<FlowDefinition>(cloneDefinition(initial?.draft ?? emptyDefinition('', '')));
	let selected = $state<Selection>(null);
	let canvas = $state<FlowCanvasApi>();
	let history = $state({ canUndo: false, canRedo: false });
	let status = $state<FlowStatus>(initial?.status ?? 'draft');
	let version = $state(initial?.version ?? 0);
	let savedAt = $state(initial?.updated_at ?? '');
	// The slug the engine answers at until a save moves it.
	let savedSlug = $state(initial?.slug ?? '');

	const flowId = initial?.id ?? '';
	const definitionJSON = $derived(JSON.stringify(definition));

	// Dirty is a comparison, not a flag. The canonical form of what is on the
	// canvas against the canonical form of what the server holds is right
	// after an undo back to the saved state, which a flag set on every change
	// cannot be.
	const canonical = $derived(cleanJSON(definition));
	let saved = $state(cleanJSON(untrack(() => definition)));
	const dirty = $derived(canonical !== saved);

	// The canonical draft known to be the published version, or null when
	// it is not known to be. Publish has nothing to do while the draft on
	// the canvas is that one and the flow is live.
	let liveDraft = $state<string | null>(
		untrack(() => (initial && draftIsLive(initial, data.versions) ? cleanJSON(definition) : null)),
	);

	// Validation, 500 ms after the last change. A browser client so the CSRF
	// cookie is echoed on the write. The saved draft was validated when it was
	// saved, so the first render and a reseed ask nothing.
	let validation = $state<ValidationResult | null>(null);
	let validating = $state(false);
	$effect(() => {
		const snap = canonical;
		if (snap === untrack(() => saved) && untrack(() => validation) === null) return;
		const timer = setTimeout(() => {
			void validate(snap);
		}, 500);
		return () => clearTimeout(timer);
	});

	/** Puts the server's draft on the canvas after an action moved it there. */
	function reseed(flow: { draft: FlowDefinition; status: FlowStatus; version: number; updated_at: string; slug?: string }) {
		definition = cloneDefinition(flow.draft);
		if (flow.slug) savedSlug = flow.slug;
		saved = cleanJSON(flow.draft);
		status = flow.status;
		version = flow.version;
		savedAt = flow.updated_at;
		liveDraft = draftIsLive(flow, data.versions) ? saved : null;
		selected = null;
		validation = null;
		runBlocked = false;
	}

	function browserClient() {
		return createClient(fetch, csrfHeaders());
	}

	async function validate(snap: string) {
		if (!flowId) return;
		validating = true;
		try {
			validation = await validateFlow(browserClient(), flowId, JSON.parse(snap) as FlowDefinition);
		} catch {
			// A refused validation is not a broken draft. The save reports it.
		} finally {
			validating = false;
		}
	}

	const errors = $derived(validation?.errors ?? []);

	// The problems list opens from the count in the toolbar and closes with
	// its last problem.
	let showProblems = $state(false);
	const problems = $derived(errors.map((e, i) => ({ item: describeError(e, definition, data.catalog, i), err: e })));
	const problemItems = $derived(problems.map((p) => p.item));
	const errorOf = (item: ProblemItem) => problems.find((p) => p.item.key === item.key)?.err;

	/**
	 * Takes the reader to what an error names: the node is selected, so the
	 * inspector shows the field it is about, and brought into view. An error
	 * on the flow itself or its trigger shows the flow settings, which is
	 * what the inspector holds with nothing selected.
	 */
	function focusProblem(err: ValidationError) {
		const onNode = !!err.node_id && err.node_id !== 'trigger' && !!nodeById(definition, err.node_id);
		selected = onNode ? { kind: 'node', id: err.node_id as string } : null;
		inspectorOpen = true;
		if (typeof window !== 'undefined' && !window.matchMedia?.('(min-width: 1280px)').matches) {
			showInspector = true;
			showPalette = false;
		}
		canvas?.reveal(onNode ? (err.node_id as string) : 'trigger');
	}

	// Introspection, once per datasource for the life of the page. The loading
	// entry is written before the request leaves so the form's effect asks once.
	let tables = $state<Record<string, TablesState>>({});

	async function introspect(id: string) {
		tables = { ...tables, [id]: { status: 'loading', tables: [] } };
		try {
			const result = await introspectDatasource(browserClient(), id);
			tables = { ...tables, [id]: { status: 'ready', tables: result.tables } };
		} catch {
			tables = { ...tables, [id]: { status: 'error', tables: [], message: 'The tables could not be listed. Check the datasource and try again.' } };
		}
	}

	/** Puts a template on the canvas, keeping this flow's name and slug, and brings all of it into view. */
	async function startFromTemplate(t: FlowTemplate) {
		definition = {
			...cloneDefinition(t.definition),
			name: definition.name,
			slug: definition.slug,
			description: definition.description ?? t.definition.description,
		};
		selected = null;
		showGallery = false;
		await tick();
		canvas?.fit();
	}

	let showKeys = $state(false);

	// The three ways to start an empty canvas, none of them required. A
	// reader may drag a node in without answering. These are the same three
	// doors GitHub Actions opens on a new workflow, from inside the editor
	// rather than before it exists.
	let showGallery = $state(false);
	// Templates the tenant keeps: this flow, a URL, a file or a paste.
	let templateError = $state('');
	let templateSaving = $state(false);
	let templateDeleteForm = $state<HTMLFormElement | undefined>();
	let templateDeleteId = $state('');
	const templateSave: SubmitFunction = () => {
		templateSaving = true;
		templateError = '';
		return async ({ result, update, formElement }) => {
			templateSaving = false;
			if (result.type === 'failure') {
				templateError = String((result.data as { templateError?: string })?.templateError ?? 'The template could not be saved.');
				return;
			}
			if (result.type === 'success') {
				if (formElement !== templateDeleteForm) formElement.reset();
				const d = result.data as { savedTemplate?: string; deletedTemplate?: string } | undefined;
				toast.success(d?.deletedTemplate ? 'Template deleted' : 'Template saved');
			}
			await update({ reset: false, invalidateAll: true });
		};
	};
	async function deleteTemplate(id: string, name: string) {
		const ok = await confirm(`Delete the template ${name}?`, 'Flows already started from it keep what they have.', { confirmLabel: 'Delete' });
		if (!ok) return;
		templateDeleteId = id;
		await tick();
		templateDeleteForm?.requestSubmit();
	}

	/** Opens the palette where it is closed, and puts the cursor in its filter. */
	async function startFromPalette() {
		paletteOpen = true;
		showPalette = true;
		showInspector = false;
		await tick();
		document.getElementById('palette-search')?.focus();
	}

	// Below the xl breakpoint the two side panels overlay the canvas one at a
	// time, opened from the toolbar. Above it they are beside it, and each
	// collapses to a strip. The collapse is for the session. The widths the
	// panels own are remembered.
	let showPalette = $state(false);
	let showInspector = $state(false);
	let paletteOpen = $state(true);
	let inspectorOpen = $state(true);

	// Focus mode: the app's sidebar narrows to its icon rail and the header
	// goes while the editor is open, and the toolbar keeps the way back. The
	// page owns the toggle and its memory. The layout only hears the ask
	// through the shell context, and leaving the page withdraws it so the
	// next page gets its frame back.
	const shell = useShell();
	let focus = $state(false);
	let focusRestored = false;

	function storage(): Storage | null {
		try {
			return typeof localStorage === 'undefined' ? null : localStorage;
		} catch {
			return null;
		}
	}

	$effect(() => {
		// Read first and unconditionally, as the sidebar's own memory does: an
		// effect that only writes on its first pass never depends on the state
		// and never runs again.
		const on = focus;
		if (!focusRestored) {
			focusRestored = true;
			focus = readFocus(storage());
			return;
		}
		writeFocus(storage(), on);
	});

	$effect(() => {
		if (shell) shell.focus = focus;
	});

	// The opening fit uses the width the canvas has beside the sidebar and
	// under the header. Focus mode changes both, so the fit runs again once
	// the shell has laid out. Under a test there is no shell and no layout.
	$effect(() => {
		void focus;
		if (!shell) return;
		tick().then(() => canvas?.openingFit());
	});

	$effect(() => () => {
		if (shell) shell.focus = false;
	});

	// Test runs
	let triggerJSON = $state('');
	let triggerType = $state('');
	// The kind of an event trigger changes the payload shape as much as the
	// type does, and a system event's name and scope are part of it, so the
	// sample follows those and nothing else in the config.
	$effect(() => {
		const { type, config } = definition.trigger;
		const key = type === 'trigger.event' && config.kind === 'system' ? `${type}:system:${String(config.name ?? '')}:${String(config.schema ?? '')}` : `${type}:${String(config.kind ?? '')}`;
		if (key !== triggerType) {
			triggerType = key;
			triggerJSON = defaultTriggerJSON(type, untrack(() => config), specFor(data.catalog, type));
		}
	});
	let live = $state(false);
	let untilNode = $state<string | null>('');
	let testing = $state(false);
	let testError = $state('');
	let lastRun = $state<FlowRun | null>(null);
	let focusStep = $state<string | null>(null);

	// A contributed trigger's payload is spread beside its type, and the
	// catalog names none of the keys, so the hint says where they go.
	const contributedTrigger = $derived(specFor(data.catalog, definition.trigger.type)?.plugin !== undefined);

	const nodeOptions = $derived([
		{ value: '', label: 'Run to the end' },
		...definition.nodes.map((n) => ({ value: n.id, label: n.name ? `${n.name} (${n.id})` : n.id })),
	]);

	async function runTest() {
		let trigger: unknown;
		try {
			trigger = triggerJSON.trim() ? JSON.parse(triggerJSON) : {};
		} catch {
			testError = 'The trigger is not valid JSON.';
			return;
		}
		testing = true;
		testError = '';
		try {
			lastRun = await testFlow(browserClient(), flowId, {
				trigger,
				definition: cloneDefinition(definition),
				live,
				until_node: untilNode || undefined,
			});
			focusStep = null;
			tab = 'test';
			drawerOpen = true;
		} catch (err) {
			const message = err instanceof Error ? err.message : '';
			// The engine refuses a blocked flow with one static message, and a
			// definition naming a type no started plugin contributes with the
			// validation list. Neither is a run that failed: the first is the
			// banner, the second lands on the node it names.
			if (isBlockedMessage(message)) {
				runBlocked = true;
				drawerOpen = false;
				return;
			}
			const refused = validationErrors(message);
			if (refused.length > 0) {
				validation = { ok: false, errors: refused };
				showProblems = true;
				testError = 'The definition did not validate.';
				return;
			}
			testError = message || 'The test run failed.';
		} finally {
			testing = false;
		}
	}

	// Export
	let showExport = $state(false);
	let exportFormat = $state<'json' | 'yaml'>('json');
	let exportText = $state('');
	let exportError = $state('');

	async function loadExport(format: 'json' | 'yaml') {
		exportFormat = format;
		exportError = '';
		try {
			const text = await exportFlow(fetch, flowId, format, csrfHeaders());
			exportText = format === 'json' ? JSON.stringify(JSON.parse(text), null, 2) : text;
		} catch {
			exportError = 'The export could not be loaded. Save the draft and try again.';
		}
	}

	function openExport() {
		exportText = '';
		showExport = true;
		void loadExport(exportFormat);
	}

	let showImport = $state(false);
	let showDelete = $state(false);
	let disableForm = $state<HTMLFormElement | undefined>();

	// Drawer
	let drawerOpen = $state(true);
	let tab = $state('test');
	// The Assistant tab exists only when the engine offers the assistant's
	// catalog. A tab that could only say it is not enabled is left out rather
	// than shown locked.
	const assistantOn = $derived(data.assistant === 'ready');
	const tabs = $derived([
		{ id: 'test', label: 'Test' },
		{ id: 'runs', label: 'Runs', count: data.runs?.length ?? 0 },
		...(assistantOn ? [{ id: 'assistant', label: 'Assistant' }] : []),
		{ id: 'guide', label: 'Guide' },
	]);

	// The assistant. The page holds what the two actions answered. The tab
	// renders it. A draft is never written anywhere until it is accepted onto
	// the canvas, and from there it is saved like any other edit.
	let assistStatus = $state<AssistantStatus>('idle');
	let assistMessage = $state('');
	let assistBusy = $state<'draft' | 'answer' | null>(null);
	let assistPrompt = $state('');
	let assistDraft = $state<AssistantDraft | null>(null);
	let assistAnswer = $state<AssistantAnswer | null>(null);
	let conversationId = $state('');
	// What the hidden explain form asks about. Set, then submitted on the next tick.
	let explainTarget = $state<{ node_id: string; problem: string }>({ node_id: '', problem: '' });
	let explainForm = $state<HTMLFormElement>();

	const assistSubmit: SubmitFunction = () => {
		assistBusy = 'draft';
		assistStatus = 'idle';
		return async ({ update }) => {
			await update({ reset: false });
			assistBusy = null;
		};
	};

	const explainSubmit: SubmitFunction = () => {
		assistBusy = 'answer';
		assistStatus = 'idle';
		tab = 'assistant';
		drawerOpen = true;
		return async ({ update }) => {
			await update({ reset: false });
			assistBusy = null;
		};
	};

	/** Asks about a node or a problem through the hidden explain form. */
	async function ask(target: { node_id?: string; problem?: ValidationError }) {
		explainTarget = { node_id: target.node_id ?? '', problem: target.problem ? JSON.stringify(target.problem) : '' };
		await tick();
		explainForm?.requestSubmit();
	}

	/**
	 * Puts the draft on the canvas. It goes through the same door a read
	 * from the engine does, and the canvas records it as one undo step, so
	 * Ctrl+Z is the way back. The flow keeps its slug: the draft is this
	 * flow's next version, not a new flow.
	 */
	async function acceptDraft() {
		const draft = assistDraft?.draft;
		if (!draft?.definition || draft.problems.length > 0) return;
		definition = normalizeDefinition({
			...draft.definition,
			name: draft.definition.name || definition.name,
			slug: definition.slug,
		});
		selected = null;
		assistDraft = null;
		await tick();
		canvas?.fit();
		toast.success('Draft accepted. Save to keep it.');
	}

	function discardDraft() {
		assistDraft = null;
		conversationId = '';
	}

	function resetConversation() {
		assistDraft = null;
		assistAnswer = null;
		conversationId = '';
		assistStatus = 'idle';
	}

	/** A draft problem names a node. When the canvas has one by that id it is selected. */
	function focusDraftProblem(p: AssistProblem) {
		if (p.node_id && nodeById(definition, p.node_id)) selected = { kind: 'node', id: p.node_id };
	}

	/** Loads a past run into the viewer without leaving the page. */
	const openRun: SubmitFunction = () =>
		async ({ update }) => {
			await update({ reset: false });
			tab = 'test';
			drawerOpen = true;
		};

	// Action results. Each answer is applied once and untracked: the toast
	// store reads its own list as it appends, and an effect that tracked that
	// read would re-run on its own write.
	let announced: unknown = null;
	$effect(() => {
		if (!form || form === announced) return;
		announced = form;
		untrack(() => applyForm(form));
	});

	function applyForm(form: NonNullable<ActionData>) {
		if ('saved' in form && form.saved) {
			saved = canonical;
			savedAt = form.saved.updated_at;
			status = form.saved.status;
			version = form.saved.version;
			if (form.saved.slug && form.saved.slug !== savedSlug) {
				toast.success(`Saved. The flow answers at ${form.saved.slug} now`);
				savedSlug = form.saved.slug;
			} else {
				toast.success('Draft saved');
			}
		}
		if ('published' in form && form.published) {
			saved = canonical;
			liveDraft = canonical;
			status = form.published.status;
			version = form.published.version;
			if (form.published.slug) savedSlug = form.published.slug;
			runBlocked = false;
			toast.success(`Published version ${form.published.version}`);
		}
		if ('reloaded' in form && form.reloaded) {
			reseed(form.reloaded);
			const unresolved = 'unresolved' in form && Array.isArray(form.unresolved) ? form.unresolved : [];
			if (unresolved.length > 0) toast.warn(`Imported. Missing datasources: ${unresolved.join(', ')}`);
			else toast.success(`Draft is now version ${form.reloaded.version > 0 ? form.reloaded.version : 'unpublished'}`);
		}
		if ('disabled' in form && form.disabled) {
			status = form.disabled.status;
			runBlocked = false;
			toast.success('Flow disabled');
		}
		if ('run' in form && form.run) {
			lastRun = form.run;
			focusStep = null;
		}
		if ('errors' in form && Array.isArray(form.errors)) {
			validation = { ok: false, errors: form.errors };
		}
		if ('assist' in form && form.assist) {
			assistDraft = form.assist;
			assistStatus = 'idle';
			assistMessage = '';
			assistPrompt = '';
			conversationId = form.assist.draft.conversation_id ?? conversationId;
			tab = 'assistant';
			drawerOpen = true;
		}
		if ('explain' in form && form.explain) {
			assistAnswer = form.explain;
			assistStatus = 'idle';
			assistMessage = '';
			conversationId = form.explain.answer.conversation_id ?? conversationId;
			tab = 'assistant';
			drawerOpen = true;
		}
		if ('assistRefused' in form && form.assistRefused) {
			const r = form.assistRefused;
			assistStatus = r.state;
			assistMessage = 'message' in r ? r.message : '';
			tab = 'assistant';
			drawerOpen = true;
		}
	}

	function onKey(e: KeyboardEvent) {
		if (!(e.ctrlKey || e.metaKey)) return;
		if (e.key.toLowerCase() === 's') {
			e.preventDefault();
			if (can.update && dirty) saveForm?.requestSubmit();
		} else if (e.shiftKey && e.key.toLowerCase() === 'f') {
			e.preventDefault();
			focus = !focus;
		}
	}

	let saveForm = $state<HTMLFormElement>();

	// One word for where the flow stands, with the live version beside it.
	// Draft, published and disabled are the states an editor sets. Blocked
	// is the engine's, for a published flow whose version names a node type
	// that no started plugin contributes.
	const STATUS_WORD: Record<FlowStatus, string> = { draft: 'Draft', active: 'Published', disabled: 'Disabled', blocked: 'Blocked' };
	const statusLabel = $derived.by(() => {
		const word = STATUS_WORD[status] ?? 'Draft';
		return version > 0 ? `${word} v${version}` : word;
	});

	// A run the engine refused because the flow is blocked. The status the
	// page loaded with can lag the engine's, so the refusal is a second way
	// into the same state. A reseed or a status change from a form clears it.
	let runBlocked = $state(false);
	const blocked = $derived(status === 'blocked' || runBlocked);
	// The problems list names the plugin when the draft still holds the type.
	const blockedHint = $derived(blockedText(missingPluginOf(errors)));

	const savedHint = $derived(dirty ? 'Unsaved changes' : savedAt ? `Saved ${relativeTime(savedAt)}` : 'Not saved yet');
	const pillHint = $derived(blocked ? `${blockedHint} ${savedHint}.` : savedHint);

	// Everything the toolbar does not need on every visit: the canvas action
	// first, the file actions next, then the two kinds of help. Fit to screen
	// is not here because the canvas carries it beside the zoom buttons, and
	// the flow's lifecycle sits in the toolbar as the schema builder's delete
	// does. Six rows fit the panel without a scrollbar.
	// A note is added from the palette, where it is listed as a type.
	// The list editor has no layout to arrange, so it has no layout action.
	const overflow = $derived([
		...(hasFlowCanvas ? [{ label: 'Auto layout', icon: LayoutGrid, onclick: () => canvas?.autoLayout() }] : []),
		...(can.update ? [{ label: 'Use a template', icon: LayoutTemplate, onclick: () => (showGallery = true) }] : []),
		...(can.update ? [{ label: 'Import', icon: Upload, onclick: () => (showImport = true) }] : []),
		{ label: 'Export', icon: Download, onclick: openExport },
		{ label: 'Shortcuts', icon: Keyboard, onclick: () => (showKeys = !showKeys) },
		{
			label: 'Guide',
			icon: BookOpen,
			onclick: () => {
				tab = 'guide';
				drawerOpen = true;
			},
		},
	]);

	function beforeUnload(e: BeforeUnloadEvent) {
		if (dirty) e.preventDefault();
	}

	const canPublish = $derived(definition.nodes.length > 0 && errors.length === 0 && !blocked);
	const writes = $derived(
		writeButtons({
			dirty,
			live: status === 'active' && liveDraft === canonical,
			publishable: canPublish,
			refusal: blocked ? blockedHint : definition.nodes.length === 0 ? 'Add a node before publishing' : 'Fix the issues before publishing',
		}),
	);

	const saveFlow = submitter();
	const publishFlow = submitter();
	const disableFlow = submitter();

	// A delete answers with a redirect to the list, which is the one way out
	// that must not ask about the edits it is throwing away.
	let leaving = false;
	const deleteFlow = submitter(() => (leaving = true));

	// A link out of the page asks first while there are edits: the way back,
	// the datasource and variable shortcuts, the sidebar. The navigation is
	// canceled, the question asked, and the same destination taken again
	// once the answer is yes. A reload or a closed tab is beforeUnload's.
	beforeNavigate(({ cancel, to, type }) => {
		if (leaving || !dirty || type === 'leave' || !to) return;
		cancel();
		void (async () => {
			const ok = await confirm(
				`Discard the changes to ${definition.name || 'this flow'}?`,
				'They have not been saved. Save first to keep them.',
				{ confirmLabel: 'Discard' },
			);
			if (!ok) return;
			leaving = true;
			await goto(to.url);
			leaving = false;
		})();
	});
</script>

<PageTitle title={`${data.flow?.name ?? 'Flow'} - Flows`} />

<svelte:window onkeydown={onKey} onbeforeunload={beforeUnload} />

{#if enabled && data.flow}
	<!-- The toolbar is the header: the way back and the name live in it, so
	     the shell's own title row is not rendered and the page has one row
	     before the canvas. The h1 stays, for assistive technology. -->
	<PageShell title={definition.name || data.flow.name} fill titleHidden>
		<div class="flex min-h-0 flex-1 flex-col overflow-hidden">
			<form
				method="POST"
				action="?/save"
				use:enhance={saveFlow.enhance}
				bind:this={saveForm}
				id="flow-save"
				class="hidden"
			>
				<input type="hidden" name="definition" value={definitionJSON} />
				<input type="hidden" name="name" value={definition.name} />
				<input type="hidden" name="slug" value={definition.slug} />
			</form>
			<form method="POST" action="?/publish" use:enhance={publishFlow.enhance} id="flow-publish" class="hidden">
				<input type="hidden" name="definition" value={definitionJSON} />
			</form>
			<form method="POST" action="?/disable" use:enhance={disableFlow.enhance} id="flow-disable" class="hidden" bind:this={disableForm}></form>
			{#if assistantOn}
				<form method="POST" action="?/explain" use:enhance={explainSubmit} bind:this={explainForm} id="flow-explain" class="hidden">
					<input type="hidden" name="definition" value={definitionJSON} />
					<input type="hidden" name="node_id" value={explainTarget.node_id} />
					<input type="hidden" name="problem" value={explainTarget.problem} />
					<input type="hidden" name="conversation_id" value={conversationId} />
				</form>
			{/if}

			<div class="shrink-0 border-b border-line px-3 py-2">
				<Toolbar label="Flow editor">
					<a
						href={back.href}
						data-testid="page-back"
						class="relative hit-area -ms-1 inline-flex shrink-0 items-center gap-1 rounded-md px-1 py-1 text-xs text-muted outline-none transition-colors duration-base hover:text-fg focus-visible:ring-2 focus-visible:ring-brand"
					>
						<ArrowLeft size={ICON.sm} aria-hidden="true" class="shrink-0" />
						{back.label}
					</a>
					<!-- The row reads as the schema builder's: the page's own tools on
					     the left, then the thing being edited and its state. A datasource
					     or a variable is what a node most often turns out to be missing,
					     so both are a click from the canvas. The words show once the row
					     has room for them. -->
					<Button variant="ghost" size="sm" href={fromFlow('/admin/flows/datasources', flowId)} aria-label="Datasources" data-testid="flow-datasources">
						<Database size={ICON.sm} />
						<span class="hidden 2xl:inline">Datasources</span>
					</Button>
					<Button variant="ghost" size="sm" href={fromFlow('/admin/flows/variables', flowId)} aria-label="Variables" data-testid="flow-variables">
						<Variable size={ICON.sm} />
						<span class="hidden 2xl:inline">Variables</span>
					</Button>
					<Dropdown items={overflow} align="left">
						{#snippet trigger({ open, toggle })}
							<Button variant="ghost" size="sm" aria-label="More actions" aria-haspopup="menu" aria-expanded={open} onclick={toggle}>
								<Ellipsis size={ICON.sm} />
							</Button>
						{/snippet}
					</Dropdown>
					<Input
						id="flow-name"
						aria-label="Flow name"
						value={definition.name}
						class="w-48 lg:w-56"
						oninput={(e) => (definition = { ...definition, name: e.currentTarget.value })}
					/>
					<Tooltip text={pillHint} position="bottom">
						<span class="inline-flex items-center gap-2" data-testid="flow-status">
							{#if definition.slug}
								<code class="hidden truncate font-mono text-xs text-faint lg:inline">{definition.slug}</code>
							{/if}
							<Badge tone={statusTone(status)} dot>{statusLabel}</Badge>
							{#if dirty}
								<Badge tone="warn" dot>Unsaved changes</Badge>
							{:else}
								<Badge tone="success" dot>Saved</Badge>
							{/if}
						</span>
					</Tooltip>
					<ProblemsMenu
						id="flow-problems"
						title="Fix these before publishing"
						problems={problemItems}
						bind:open={showProblems}
						onjump={(p) => {
							const err = errorOf(p);
							if (err) focusProblem(err);
						}}
					>
						{#snippet action(p)}
							{#if assistantOn}
								<Button
									variant="ghost"
									size="sm"
									aria-label="Ask the assistant about this problem"
									disabled={assistBusy !== null}
									onclick={() => {
										const err = errorOf(p);
										if (err) void ask({ problem: err });
									}}
								>
									<WandSparkles size={ICON.sm} />
								</Button>
							{/if}
						{/snippet}
					</ProblemsMenu>
					{#snippet actions()}
						<!-- The panes are overlays up to xl:. Docked at md: they would leave
						     a 768px window, with the shell's sidebar, no canvas at all. -->
						<ButtonGroup class="xl:hidden">
							<Button variant="ghost" size="sm" aria-label="Node palette" aria-pressed={showPalette} onclick={() => { showPalette = !showPalette; showInspector = false; }}>
								<PanelLeft size={ICON.sm} />
							</Button>
							<Button variant="ghost" size="sm" aria-label="Inspector" aria-pressed={showInspector} onclick={() => { showInspector = !showInspector; showPalette = false; }}>
								<PanelRight size={ICON.sm} />
							</Button>
						</ButtonGroup>
						<!-- The list editor keeps no history, so it offers no undo. -->
						{#if hasFlowCanvas}
							<ButtonGroup>
								<Button variant="ghost" size="sm" disabled={!history.canUndo} onclick={() => canvas?.undo()} aria-label="Undo" hint="Undo (Ctrl+Z)">
									<Undo2 size={ICON.sm} />
								</Button>
								<Button variant="ghost" size="sm" disabled={!history.canRedo} onclick={() => canvas?.redo()} aria-label="Redo" hint="Redo (Ctrl+Shift+Z)">
									<Redo2 size={ICON.sm} />
								</Button>
							</ButtonGroup>
						{/if}
						<Button
							variant="ghost"
							size="sm"
							class="hidden md:inline-flex"
							aria-label={focus ? 'Exit focus mode' : 'Focus mode'}
							aria-pressed={focus}
							hint={focus ? 'Exit focus mode (Ctrl+Shift+F)' : 'Focus mode (Ctrl+Shift+F)'}
							data-testid="focus-toggle"
							onclick={() => (focus = !focus)}
						>
							{#if focus}<Shrink size={ICON.sm} />{:else}<Expand size={ICON.sm} />{/if}
						</Button>
						<!-- The flow's lifecycle, icon-only in the danger tone beside the
						     primary actions, as the schema builder places its delete. -->
						{#if status === 'active' && can.activate}
							<Button variant="ghost" size="sm" class="text-danger" aria-label="Disable flow" hint="Stop serving the published version" onclick={() => disableForm?.requestSubmit()}>
								<Ban size={ICON.sm} />
							</Button>
						{/if}
						{#if can.delete}
							<Button variant="ghost" size="sm" class="text-danger" aria-label="Delete flow" hint="Delete the flow, its versions and its runs" onclick={() => (showDelete = true)}>
								<Trash2 size={ICON.sm} />
							</Button>
						{/if}
						{#if can.activate}
							<Button variant="secondary" size="sm" onclick={runTest} loading={testing}>
								<FlaskConical size={ICON.sm} />
								Test
							</Button>
						{/if}
						{#if can.update}
							<Button variant={writes.save.variant} size="sm" type="submit" form="flow-save" disabled={writes.save.disabled} hint={writes.save.hint} loading={saveFlow.pending}>
								<Save size={ICON.sm} />
								Save
							</Button>
						{/if}
						{#if can.activate}
							<Button variant={writes.publish.variant} size="sm" type="submit" form="flow-publish" disabled={writes.publish.disabled} hint={writes.publish.hint} loading={publishFlow.pending}>
								<Rocket size={ICON.sm} />
								Publish
							</Button>
						{/if}
					{/snippet}
				</Toolbar>
				{#if showKeys}
					<p class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-faint" data-testid="keyboard-hints">
						{#if hasFlowCanvas}
							<span><Kbd>Ctrl</Kbd> <Kbd>Z</Kbd> undo</span>
							<span><Kbd>Ctrl</Kbd> <Kbd>Shift</Kbd> <Kbd>Z</Kbd> redo</span>
						{/if}
						<span><Kbd>Del</Kbd> remove the selection</span>
						{#if hasFlowCanvas}
							<span><Kbd>Shift</Kbd> drag to select several, <Kbd>Shift</Kbd> click to add one</span>
							<span><Kbd>Space</Kbd> drag to pan</span>
							<span><Kbd>Alt</Kbd> drag off the grid</span>
							<span><Kbd>+</Kbd> <Kbd>-</Kbd> zoom, <Kbd>Shift</Kbd> <Kbd>1</Kbd> fit, <Kbd>Shift</Kbd> <Kbd>0</Kbd> 100%</span>
							<span><Kbd>Tab</Kbd> to a node, <Kbd>Enter</Kbd> to select it, arrows to nudge</span>
						{:else}
							<span><Kbd>Tab</Kbd> to a node, <Kbd>Enter</Kbd> to select it</span>
						{/if}
						<span><Kbd>Ctrl</Kbd> <Kbd>S</Kbd> save</span>
						<span><Kbd>Ctrl</Kbd> <Kbd>Shift</Kbd> <Kbd>F</Kbd> focus mode</span>
					</p>
				{/if}
			</div>

			{#if blocked}
				<div class="shrink-0 px-3 pt-2" data-testid="flow-blocked">
					<Alert tone="warn" title="This flow is blocked">
						{#snippet children()}{blockedHint} It runs again on its own once the plugin is started.{/snippet}
					</Alert>
				</div>
			{/if}
			{#if refusal}
				<!-- The refusal is drawn where a validation problem is: the ids
				     are in the problems list and on the canvas, and this says
				     what they have in common and where the feature is turned on. -->
				<div class="shrink-0 px-3 pt-2" data-testid="flow-refusal">
					<Alert tone="warn" title={refusal.limit !== null ? 'Flow limit reached' : 'Not enabled on this instance'} dismissible>
						{#snippet children()}
							{form && 'error' in form ? form.error : ''}
							{#if enableLink}
								<a class="ml-1 underline" href={enableLink.href}>{enableLink.label ?? (refusal.limit !== null ? 'How to raise the limit' : 'How to enable it')}</a>
							{/if}
						{/snippet}
					</Alert>
				</div>
			{:else if form && 'forbidden' in form && form.forbidden}
				<div class="shrink-0 px-3 pt-2" data-testid="flow-forbidden">
					<Alert tone="danger" title="Your role cannot do that" dismissible>
						{#snippet children()}{form.error}{/snippet}
					</Alert>
				</div>
			{:else if form && 'error' in form && form.error}
				<div class="shrink-0 px-3 pt-2">
					<Alert tone="danger" dismissible>
						{#snippet children()}{form.error}{/snippet}
					</Alert>
				</div>
			{/if}

			<div class="relative flex min-h-0 flex-1">
				<SidePanel name="palette" label="Palette" side="start" bind:open={paletteOpen} overlay={showPalette}>
					<NodePalette
						catalog={data.catalog}
						onadd={(type) => {
							canvas?.addNodeAtCenter(type);
							showPalette = false;
						}}
					/>
				</SidePanel>

				<div class="relative min-w-0 flex-1">
					<FlowCanvas
						bind:this={canvas}
						bind:definition
						bind:selected
						catalog={data.catalog}
						runSteps={lastRun?.steps ?? []}
						{errors}
						onhistory={(h) => (history = h)}
					>
						{#snippet empty()}
							<EmptyState
								title={hasFlowCanvas ? 'An empty canvas' : 'No nodes yet'}
								description={hasFlowCanvas
									? 'The trigger on the left starts every run. Drag a node in from the palette, or pick a way in below.'
									: 'The trigger above starts every run. Add a node from the palette, or pick a way in below.'}
							>
								{#snippet iconSnippet()}<Workflow size={ICON.lg} />{/snippet}
								{#snippet action()}
									<!-- One column of equal buttons: three doors side by side rank
									     themselves by width, and a column reads as a choice. -->
									<div class="flex w-64 flex-col gap-2" data-testid="empty-offers">
										<Button variant="secondary" full onclick={startFromPalette}>
											<PanelLeft size={ICON.sm} />
											Start from the palette
										</Button>
										<Button variant="secondary" full onclick={() => (showGallery = true)}>
											<LayoutTemplate size={ICON.sm} />
											Use a template
										</Button>
										{#if can.update}
											<Button variant="secondary" full onclick={() => (showImport = true)}>
												<Upload size={ICON.sm} />
												Import YAML or JSON
											</Button>
										{/if}
									</div>
								{/snippet}
							</EmptyState>
						{/snippet}
					</FlowCanvas>
				</div>

				<SidePanel name="inspector" label="Inspector" side="end" bind:open={inspectorOpen} overlay={showInspector}>
					<FlowInspector
						{definition}
						catalog={data.catalog}
						{selected}
						{errors}
						schemas={data.schemas}
						datasources={data.datasources}
						variables={data.variables}
						flows={data.flows}
						flowId={data.flow.id}
						{savedSlug}
						origin={page.url.origin}
						eventTypes={data.eventTypes}
						{tables}
						onintrospect={(id) => void introspect(id)}
						onchange={(def) => (definition = def)}
						onselect={(sel) => (selected = sel)}
						onguide={() => {
							tab = 'guide';
							drawerOpen = true;
						}}
						onassist={assistantOn && selected?.kind === 'node' ? () => void ask({ node_id: selected?.kind === 'node' ? selected.id : '' }) : undefined}
					/>
					{#if !selected}
						<div class="flex flex-col gap-3 border-t border-line p-4">
							{#if data.versions.length > 0}
								<SectionHeading level={2} variant="eyebrow">Versions</SectionHeading>
								<ul class="flex flex-col gap-1 text-sm">
									{#each data.versions as v (v.version)}
										<li class="flex items-center justify-between gap-2">
											<span class="text-fg">v{v.version}</span>
											<span class="text-xs text-faint" title={formatDateTime(v.created_at)}>{relativeTime(v.created_at)}</span>
											{#if v.version !== version && can.activate}
												<form method="POST" action="?/rollback" use:enhance>
													<input type="hidden" name="version" value={v.version} />
													<Button variant="ghost" size="sm" type="submit">Roll back</Button>
												</form>
											{:else if v.version === version}
												<Badge tone="success" size="sm">live</Badge>
											{/if}
										</li>
									{/each}
								</ul>
							{/if}
						</div>
					{/if}
				</SidePanel>
			</div>

			<EditorDrawer bind:open={drawerOpen} active={tab} items={tabs} onchange={(id) => (tab = id)}>
				{#if tab === 'test'}
					<div class="flex h-full min-h-0 flex-col md:flex-row">
						<div
							class="flex shrink-0 flex-col gap-3 overflow-y-auto border-b border-line p-3 md:w-72 md:border-b-0 md:border-r lg:w-80"
						>
							<Textarea
								id="test-trigger"
								label="Trigger"
								hint={contributedTrigger
									? 'What the trigger hands the flow. The plugin puts its payload keys beside type. Add the ones the flow reads.'
									: 'What the trigger hands the flow. Edit it to test another input.'}
								rows={6}
								bind:value={triggerJSON}
								mono
							/>
							<Toggle id="test-live" label="Live side effects" hint="Off runs writes and calls as dry runs." bind:checked={live} />
							<Select id="test-until" label="Until node" options={nodeOptions} placeholder="Run to the end" bind:value={untilNode} />
							{#if testError}
								<Alert tone="danger">
									{#snippet children()}{testError}{/snippet}
								</Alert>
							{/if}
							<Button variant="primary" onclick={runTest} loading={testing}>
								<Play size={ICON.sm} />
								Run test
							</Button>
						</div>
						<div class="min-w-0 flex-1">
							<RunViewer run={lastRun} focus={focusStep} onrerun={runTest} rerunning={testing} />
						</div>
					</div>
				{:else if tab === 'runs'}
					<div class="h-full overflow-y-auto p-3">
						{#if data.runs.length === 0}
							<p class="text-sm text-muted">No runs recorded yet.</p>
						{:else}
							<Table hoverable label="Versions">
								<thead>
									<tr>
										<th scope="col">Status</th>
										<th scope="col">Trigger</th>
										<th scope="col">Kind</th>
										<th scope="col">Duration</th>
										<th scope="col">Started</th>
										<th scope="col">Actions</th>
									</tr>
								</thead>
								<tbody>
									{#each data.runs as run (run.id)}
										<tr>
											<td><Badge tone={statusTone(run.status)} dot>{run.status}</Badge></td>
											<td data-cell="nowrap" class="text-muted">{triggerLabel(run.trigger_type)}</td>
											<td data-cell="nowrap" class="text-muted">{run.is_test ? 'test' : 'live'}</td>
											<td data-cell="nowrap" class="tabular-nums text-muted">{formatDuration(run.duration_ms)}</td>
											<td data-cell="nowrap" class="text-muted" title={formatDateTime(run.started_at)}>{formatDateTime(run.started_at)}</td>
											<td>
												<form method="POST" action="?/run" use:enhance={openRun}>
													<input type="hidden" name="run_id" value={run.id} />
													<Button variant="ghost" size="sm" type="submit" aria-label="Open run {run.id}" title="Open">
														<Play size={ICON.sm} />
													</Button>
												</form>
											</td>
										</tr>
									{/each}
								</tbody>
							</Table>
						{/if}
					</div>
				{:else if tab === 'assistant' && assistantOn}
					<AssistantPanel
						status={assistStatus}
						message={assistMessage}
						busy={assistBusy}
						{definitionJSON}
						{conversationId}
						bind:prompt={assistPrompt}
						draft={assistDraft}
						answer={assistAnswer}
						onsubmit={assistSubmit}
						onaccept={() => void acceptDraft()}
						ondiscard={discardDraft}
						onclose={() => (assistAnswer = null)}
						onreset={resetConversation}
						onproblem={focusDraftProblem}
					/>
				{:else}
					<div class="h-full overflow-y-auto">
						<FlowGuide templates={data.templates} />
					</div>
				{/if}
			</EditorDrawer>
		</div>
	</PageShell>

	{#if showExport}
		<Modal open title="Export {definition.name}" onclose={() => (showExport = false)}>
			{#snippet children()}
				<div class="flex flex-col gap-3">
					<div class="flex items-center justify-between gap-2">
						<SegmentedControl
							label="Format"
							labelHidden
							size="sm"
							value={exportFormat}
							options={[
								{ value: 'json', label: 'JSON' },
								{ value: 'yaml', label: 'YAML' },
							]}
							onchange={(v) => void loadExport(v)}
						/>
						<CopyButton value={exportText} label="Copy" />
					</div>
					<p class="text-xs text-muted">The saved draft, secrets stripped. Datasources are named, not carried.</p>
					{#if exportError}
						<Alert tone="danger">
							{#snippet children()}{exportError}{/snippet}
						</Alert>
					{/if}
					<pre class="max-h-96 overflow-auto rounded-md border border-line bg-surface-2 p-3 font-mono text-xs text-fg">{exportText || 'Loading'}</pre>
					{#if exportText}
						<a
							class="text-xs text-brand underline"
							download="{definition.slug || 'flow'}.{exportFormat}"
							href={`data:${exportFormat === 'json' ? 'application/json' : 'application/yaml'};charset=utf-8,${encodeURIComponent(exportText)}`}
						>
							Download {exportFormat.toUpperCase()}
						</a>
					{/if}
				</div>
			{/snippet}
			{#snippet footer()}
				<Button variant="secondary" onclick={() => (showExport = false)}>Close</Button>
			{/snippet}
		</Modal>
	{/if}

	<!-- Drawers, like the schema builder's presets and import: a gallery and a
	     form are panels beside the canvas, and a Modal is for a confirmation. -->
	<Drawer bind:open={showGallery} title="Use a template" size="lg">
		<div class="flex flex-col gap-4">
			<p class="text-sm text-muted">A template puts its trigger and nodes on this canvas. The flow keeps its name and slug, and nothing is saved until you save.</p>
			{#if can.update}
				<Collapsible label="Save a template">
					<div class="flex flex-col gap-4 pt-2">
						<p class="text-sm text-muted">A saved template is listed here beside the built-in ones. It is named by its slug. Saving the same slug again replaces it, so reading the URL again refreshes it.</p>
						<form method="POST" action="?/saveTemplate" use:enhance={templateSave}>
							<input type="hidden" name="document" value={JSON.stringify({ ...definition, name: data.flow.name, slug: data.flow.slug })} />
							<Button variant="secondary" type="submit" loading={templateSaving}>Save this flow as a template</Button>
						</form>
						<form method="POST" action="?/saveTemplate" enctype="multipart/form-data" use:enhance={templateSave} class="flex flex-col gap-4">
							<Input id="template-url" name="url" type="url" label="URL" placeholder="https://example.com/flows/welcome.yaml" hint="Read over http or https. Private and loopback addresses are refused." />
							<FileInput id="template-file" name="file" label="Or a file" accept=".json,.yaml,.yml,application/json,application/yaml" />
							<Textarea id="template-document" name="document" label="Or paste the definition" rows={6} class="[&_textarea]:text-xs" mono />
							<div class="flex justify-end">
								<Button variant="primary" type="submit" loading={templateSaving}>Save</Button>
							</div>
						</form>
						{#if templateError}
							<Alert tone="danger">{templateError}</Alert>
						{/if}
					</div>
				</Collapsible>
			{/if}
			{#if data.templates.length === 0}
				<EmptyState title="No templates" description="The engine offered none. Start from the palette or import a definition instead." />
			{:else}
				<div class="grid gap-3 sm:grid-cols-2" data-testid="template-gallery">
					{#each data.templates as t (t.id)}
						<Card heading={t.name} headingLevel={3} description={t.description}>
							<div class="flex flex-wrap items-center gap-2">
								{#if t.source === 'saved'}
									<Badge tone="brand" size="sm">Saved</Badge>
								{/if}
								{#if t.enabled === false}
									<span data-testid="template-locked"><Badge tone="neutral" size="sm"><Lock size={ICON.xs} aria-hidden="true" /> Not enabled on this instance</Badge></span>
								{/if}
								<span class="text-xs text-faint">{triggerLabel(t.definition.trigger.type)} trigger, {t.definition.nodes.length} node{t.definition.nodes.length === 1 ? '' : 's'}</span>
								{#if t.source === 'saved' && can.delete}
									<Button variant="ghost" size="sm" class="ms-auto" aria-label="Delete the template {t.name}" onclick={() => void deleteTemplate(t.id, t.name)}>
										<Trash2 size={ICON.sm} class="text-danger" />
									</Button>
								{/if}
							</div>
							{#snippet footer()}
								<Button variant="primary" onclick={() => void startFromTemplate(t)}>Use</Button>
							{/snippet}
						</Card>
					{/each}
				</div>
			{/if}
		</div>
		<form method="POST" action="?/deleteTemplate" use:enhance={templateSave} bind:this={templateDeleteForm} class="hidden">
			<input type="hidden" name="id" value={templateDeleteId} />
		</form>
		{#snippet footer()}
			<Button variant="secondary" onclick={() => (showGallery = false)}>Cancel</Button>
		{/snippet}
	</Drawer>

	<Drawer bind:open={showImport} title="Import a definition">
		<form
			method="POST"
			action="?/import"
			id="flow-import-form"
			enctype="multipart/form-data"
			use:enhance={submit.enhance}
			class="flex flex-col gap-4"
		>
			<input type="hidden" name="slug" value={data.flow.slug} />
			<p class="text-sm text-muted">The imported definition replaces the draft of this flow. The published version is not touched until you publish again.</p>
			<FileInput id="import-file" name="file" label="Definition file" accept=".json,.yaml,.yml,application/json,application/yaml" />
			<Textarea id="import-text" name="text" label="Or paste the definition" rows={10} mono />
		</form>
		{#snippet footer()}
			<Button variant="secondary" type="button" onclick={() => (showImport = false)}>Cancel</Button>
			<Button variant="primary" type="submit" form="flow-import-form">Import</Button>
		{/snippet}
	</Drawer>

	{#if showDelete}
		<Modal open title="Delete {data.flow.name}?" onclose={() => (showDelete = false)}>
			{#snippet children()}
				<p class="mb-6 text-sm text-fg">Its versions and run history go with it.</p>
				<form
					method="POST"
					action="?/delete"
					use:enhance={deleteFlow.enhance}
					class="flex justify-end gap-3"
				>
					<Button variant="secondary" type="button" onclick={() => (showDelete = false)}>Cancel</Button>
					<Button variant="danger" type="submit" loading={deleteFlow.pending}>Delete</Button>
				</form>
			{/snippet}
		</Modal>
	{/if}
{:else}
	<PageShell title="Flows" width="wide">
		<NotEnabled
			title="Flows"
			description="The engine refused the flow routes."
		/>
	</PageShell>
{/if}
