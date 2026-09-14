import type { Actions, PageServerLoad } from './$types';
import { error, fail, redirect } from '@sveltejs/kit';
import { ApiError, createClient } from '@lyeve-labs/client';
import { getSchemas } from '@lyeve-labs/client-rest';
import { authedClient, requireUser } from '$lib/server/authz';
import { actionError } from '$lib/server/action-error';
import { flowAuthHeaders, readImportForm } from '$lib/server/flow-import';
import { flowClient } from '$lib/server/flow-client';
import { forbiddenFailure } from '$lib/server/flow-forbidden';
import { refusalFailure } from '$lib/server/flow-refusal';
import { assistRefusal, catalogFor, refusalStatus } from '$lib/server/flow-assist';
import { CatalogError, assistFlow, explainFlow, getLLMCatalog, type AssistProblem } from '$lib/api/assist';
import { clearSessionCookie } from '$lib/server/session-cookie';
import {
	ImportError,
	FlowRefusal,
	deleteFlow,
	disableFlow,
	getCatalog,
	getEventTypes,
	getFlow,
	getRun,
	getTemplates,
	importFlow,
	listDatasources,
	listPublishedFlows,
	listRuns,
	listVariables,
	listVersions,
	publishFlow,
	rollbackFlow,
	saveDraft,
	validationErrors,
	type Flow,
	deleteTemplate,
	saveTemplate,
} from '$lib/api/flows';
import { emptyDefinition, type FlowDefinition, type SchemaOption } from '$lib/flow/types';
import { normalizeDefinition } from '$lib/flow/graph';
import type { HttpClient } from '@lyeve-labs/client';
import { rowsOf } from '$lib/api/list';

const RECENT_RUNS = 20;

/**
 * The status a failed read answers with. Only a 404 means the flow is gone.
 * Anything else is the engine, the session or the network, and telling the
 * operator "not found" for a 503 sends them looking for a flow that exists.
 * The message is static so driver text never reaches the page.
 */
function loadStatus(err: unknown): { status: number; message: string } {
	if (err instanceof ApiError) {
		if (err.status === 404) return { status: 404, message: 'Flow not found' };
		if (err.status === 403) return { status: 403, message: 'Your role cannot read flows' };
		if (err.status >= 400 && err.status < 600) return { status: err.status, message: 'The flow could not be read from the engine' };
	}
	return { status: 502, message: 'The flow could not be read from the engine' };
}

export const load: PageServerLoad = async ({ fetch, cookies, params, url }) => {
	const client = createClient(fetch, flowAuthHeaders({ cookies, url }));

	let flow: Flow;
	try {
		flow = await getFlow(client, params.id);
	} catch (err) {
		if (err instanceof ApiError && err.status === 402) {
			return { locked: true as const, flow: null, catalog: [], datasources: [], variables: [], schemas: [], flows: [], eventTypes: null, runs: [], versions: [], templates: [], assistant: 'hidden' as const };
		}
		// An expired session goes where the shell sends one, not to an error page.
		if (err instanceof ApiError && err.status === 401) {
			clearSessionCookie({ cookies, url });
			redirect(302, '/login');
		}
		const { status, message } = loadStatus(err);
		error(status, message);
	}
	if (!flow?.id) error(404, 'Flow not found');

	// The catalog is the one read the editor cannot do without: the palette
	// and every inspector form come from it. The rest degrade to empty.
	let loaded;
	try {
		loaded = await Promise.all([
			getCatalog(client).catch(() => []),
			listDatasources(client).then((list) => list.rows).catch(() => []),
			listVariables(client, 500, 0).catch(() => []),
			// The pickers read the content schemas, the published flows and the
			// event types. A failed read leaves each picker as free text, which
			// is the escape it carries anyway. An engine without the event-types
			// route lands here too. A 402 locks the page the way one on the flow
			// itself does.
			getSchemas(client).catch(() => []),
			listPublishedFlows(client).catch(() => []),
			getEventTypes(client).catch((err: unknown) => {
				if (err instanceof ApiError && err.status === 402) throw err;
				return null;
			}),
			listRuns(client, flow.id, { limit: RECENT_RUNS, offset: 0 }).then((p) => p.rows).catch(() => []),
			listVersions(client, flow.id).catch(() => []),
			getTemplates(client).catch(() => []),
			// The assistant's catalog decides whether the tab exists at all: a
			// 402 there means the assistant is not enabled, and a tab that could
			// only say so is better left out. Any other refusal is reported when
			// the reader asks, not on every load.
			getLLMCatalog(fetch, flowAuthHeaders({ cookies, url }))
				.then(() => 'ready' as const)
				.catch((err: unknown) => (err instanceof CatalogError && err.status === 402 ? ('hidden' as const) : ('ready' as const))),
		]);
	} catch {
		return { locked: true as const, flow: null, catalog: [], datasources: [], variables: [], schemas: [], flows: [], eventTypes: null, runs: [], versions: [], templates: [], assistant: 'hidden' as const };
	}
	const [catalog, datasources, variables, schemas, flows, eventTypes, runs, versions, templates, assistant] = loaded;

	const schemaOptions: SchemaOption[] = schemas.map((s) => ({
		name: s.name,
		display_name: s.display_name || s.name,
		fields: (s.fields ?? []).map((f) => f.name),
	}));

	return {
		locked: false as const,
		flow: { ...flow, draft: normalizeDefinition(flow.draft ?? emptyDefinition(flow.name, flow.slug)) },
		catalog,
		datasources: datasources.map((d) => ({ id: d.id, name: d.name, kind: d.kind })),
		variables: rowsOf(variables).map((v) => v.key),
		schemas: schemaOptions,
		flows,
		eventTypes,
		runs,
		versions,
		templates,
		assistant,
	};
};

/** The definition a form carries, or null when it is not JSON. */
function definitionField(data: FormData): FlowDefinition | null {
	try {
		return JSON.parse(String(data.get('definition') ?? '')) as FlowDefinition;
	} catch {
		return null;
	}
}

function refused(err: unknown, fallback: string) {
	if (err instanceof ApiError && err.status === 422) {
		return fail(422, { error: 'The definition did not validate.', errors: validationErrors(err.message) });
	}
	if (err instanceof FlowRefusal) return refusalFailure(err);
	if (err instanceof ApiError && err.status === 402) {
		return fail(402, { error: 'Flows are not enabled on this instance.', locked: true });
	}
	if (err instanceof ApiError && err.status === 403) return forbiddenFailure(err);
	return fail(400, { error: actionError(err, fallback) });
}

/** What the page reseeds the canvas from once the server's draft has moved under it. */
interface Reloaded {
	draft: FlowDefinition;
	status: Flow['status'];
	version: number;
	updated_at: string;
	name: string;
	slug: string;
}

/**
 * The flow with its draft, for an action that changed the draft on the
 * server. A rollback or an import answers with the flow, and some answers
 * leave the draft out. One more read fills it, so the page never reseeds
 * from a draft it does not have.
 */
async function reloaded(client: HttpClient, id: string, answer: Flow): Promise<Reloaded> {
	const flow = answer.draft ? answer : await getFlow(client, id);
	return {
		draft: normalizeDefinition(flow.draft ?? emptyDefinition(flow.name, flow.slug)),
		status: flow.status,
		version: flow.version,
		updated_at: flow.updated_at,
		name: flow.name,
		slug: flow.slug,
	};
}

export const actions: Actions = {
	save: async (event) => {
		await requireUser(event);
		const client = flowClient(event);
		const data = await event.request.formData();
		let definition: FlowDefinition;
		try {
			definition = JSON.parse(String(data.get('definition') ?? '')) as FlowDefinition;
		} catch {
			return fail(400, { error: 'The definition is not valid JSON.' });
		}
		const name = String(data.get('name') ?? definition.name ?? '').trim();
		if (!name) return fail(400, { error: 'A flow needs a name.' });
		const slug = String(data.get('slug') ?? definition.slug ?? '').trim();
		definition = { ...definition, name, ...(slug ? { slug } : {}) };
		try {
			const flow = await saveDraft(client, event.params.id, {
				name,
				...(slug ? { slug } : {}),
				description: definition.description ?? '',
				definition,
			});
			return { saved: { updated_at: flow.updated_at, status: flow.status, version: flow.version, slug: flow.slug } };
		} catch (err) {
			return refused(err, 'Failed to save the draft');
		}
	},

	/**
	 * Publishes the draft. The form may carry the definition on the canvas, in
	 * which case it is saved first: publishing what the reader sees, not what
	 * the last save left behind, is the only reading of the button that does
	 * not surprise anyone.
	 */
	publish: async (event) => {
		await requireUser(event);
		const client = flowClient(event);
		const data = await event.request.formData();
		const raw = String(data.get('definition') ?? '').trim();
		try {
			if (raw) {
				const definition = JSON.parse(raw) as FlowDefinition;
				await saveDraft(client, event.params.id, {
					name: definition.name,
					...(definition.slug ? { slug: definition.slug } : {}),
					description: definition.description ?? '',
					definition,
				});
			}
			const flow = await publishFlow(client, event.params.id);
			return { published: { version: flow.version, status: flow.status, slug: flow.slug } };
		} catch (err) {
			return refused(err, 'Failed to publish');
		}
	},

	disable: async (event) => {
		await requireUser(event);
		const client = authedClient(event);
		try {
			const flow = await disableFlow(client, event.params.id);
			return { disabled: { status: flow.status } };
		} catch (err) {
			return refused(err, 'Failed to disable');
		}
	},

	rollback: async (event) => {
		await requireUser(event);
		const client = flowClient(event);
		const data = await event.request.formData();
		const version = Number(data.get('version'));
		if (!Number.isInteger(version) || version < 1) return fail(400, { error: 'Choose a version to roll back to.' });
		// The draft on the canvas is now the rolled-back version. It comes back
		// in the answer rather than through a redirect: a redirect to the route
		// the reader is on reuses the component, whose canvas keeps the old
		// draft and saves it back over the rollback.
		try {
			const flow = await rollbackFlow(client, event.params.id, version);
			return { reloaded: await reloaded(client, event.params.id, flow) };
		} catch (err) {
			return refused(err, 'Failed to roll back');
		}
	},

	/**
	 * Replaces this flow's draft with a pasted or uploaded definition. The
	 * list page has the general import. This one is pinned to the flow on the
	 * canvas and answers with the new draft for the same reason rollback does.
	 */
	import: async (event) => {
		await requireUser(event);
		const client = authedClient(event);
		const data = await event.request.formData();
		const body = await readImportForm(data);
		if (!body) return fail(400, { error: 'Paste a definition or choose a file.' });
		let slug = String(data.get('slug') ?? '').trim();
		try {
			if (!slug) slug = (await getFlow(client, event.params.id)).slug;
			const result = await importFlow(event.fetch, { ...body, mode: 'replace', slug }, flowAuthHeaders(event));
			return {
				reloaded: await reloaded(client, event.params.id, result),
				unresolved: result.unresolved_datasources ?? [],
			};
		} catch (err) {
			if (err instanceof ImportError && err.status === 422) {
				return fail(422, { error: 'The definition did not validate.', errors: validationErrors(err.body) });
			}
			if (err instanceof FlowRefusal) return refusalFailure(err);
			if (err instanceof ImportError && err.status === 402) {
				return fail(402, { error: 'Flows are not enabled on this instance.', locked: true });
			}
			if (err instanceof ImportError) {
				return fail(400, { error: err.status < 500 && err.message ? err.message : 'Import failed' });
			}
			return refused(err, 'Import failed');
		}
	},

	saveTemplate: async (event) => {
		await requireUser(event);
		const client = authedClient(event);
		const data = await event.request.formData();
		const url = String(data.get('url') ?? '').trim();
		const file = data.get('file');
		let document = String(data.get('document') ?? '').trim();
		if (!document && file instanceof File && file.size > 0) document = (await file.text()).trim();
		if (!url && !document) return fail(400, { templateError: 'Give a URL, a file or a pasted definition.' });
		if (url && document) return fail(400, { templateError: 'Give a URL or a definition, not both.' });
		try {
			const saved = await saveTemplate(client, url ? { url } : { document });
			return { savedTemplate: saved.id };
		} catch (err) {
			if (err instanceof ApiError && err.status === 409) {
				return fail(409, { templateError: 'A built-in template already uses that slug. Give yours another.' });
			}
			if (err instanceof ApiError && err.status === 502) {
				return fail(502, { templateError: 'The URL did not answer with a flow definition.' });
			}
			if (err instanceof ApiError && err.status === 403) return fail(403, { templateError: 'You may not create flows here.' });
			return fail(400, { templateError: actionError(err, 'The template could not be saved.') });
		}
	},

	deleteTemplate: async (event) => {
		await requireUser(event);
		const client = authedClient(event);
		const id = String((await event.request.formData()).get('id') ?? '').trim();
		if (!id) return fail(400, { templateError: 'Choose a template.' });
		try {
			await deleteTemplate(client, id);
			return { deletedTemplate: id };
		} catch (err) {
			return fail(400, { templateError: actionError(err, 'The template could not be deleted.') });
		}
	},

	delete: async (event) => {
		await requireUser(event);
		const client = authedClient(event);
		try {
			await deleteFlow(client, event.params.id);
		} catch (err) {
			return refused(err, 'Failed to delete');
		}
		redirect(303, '/admin/flows');
	},

	/**
	 * Asks the assistant for a draft. The catalog is read here rather than
	 * carried by the form: it is the engine's to write and the browser has no
	 * reason to hold it. The draft comes back validated with what the
	 * validator still refuses, and nothing is written until the reader
	 * accepts it on the canvas and saves.
	 */
	assist: async (event) => {
		await requireUser(event);
		const client = authedClient(event);
		const data = await event.request.formData();
		const prompt = String(data.get('prompt') ?? '').trim();
		if (!prompt) return fail(400, { assistRefused: { state: 'error' as const, message: 'Say what the flow should do.' } });
		const current = definitionField(data);
		if (!current) return fail(400, { assistRefused: { state: 'error' as const, message: 'The definition is not valid JSON.' } });
		const conversation = String(data.get('conversation_id') ?? '').trim();
		try {
			const catalog = await catalogFor(event);
			const draft = await assistFlow(client, {
				prompt,
				catalog,
				current,
				...(conversation ? { conversation_id: conversation } : {}),
			});
			return { assist: { prompt, draft } };
		} catch (err) {
			const refusal = assistRefusal(err);
			return fail(refusalStatus(refusal), { assistRefused: refusal });
		}
	},

	/**
	 * Asks the assistant about the flow on the canvas: a node, one of the
	 * validator's problems, or a question. Answers with Markdown the tab
	 * renders as elements, never as HTML.
	 */
	explain: async (event) => {
		await requireUser(event);
		const client = authedClient(event);
		const data = await event.request.formData();
		const definition = definitionField(data);
		if (!definition) return fail(400, { assistRefused: { state: 'error' as const, message: 'The definition is not valid JSON.' } });
		const nodeId = String(data.get('node_id') ?? '').trim();
		const question = String(data.get('question') ?? '').trim();
		const conversation = String(data.get('conversation_id') ?? '').trim();
		let problem: AssistProblem | undefined;
		const rawProblem = String(data.get('problem') ?? '').trim();
		if (rawProblem) {
			try {
				problem = JSON.parse(rawProblem) as AssistProblem;
			} catch {
				return fail(400, { assistRefused: { state: 'error' as const, message: 'The problem is not valid JSON.' } });
			}
		}
		if (!nodeId && !problem && !question) {
			return fail(400, { assistRefused: { state: 'error' as const, message: 'Choose a node or a problem to ask about.' } });
		}
		try {
			const catalog = await catalogFor(event);
			const answer = await explainFlow(client, {
				catalog,
				definition,
				...(nodeId ? { node_id: nodeId } : {}),
				...(problem ? { problem } : {}),
				...(question ? { question } : {}),
				...(conversation ? { conversation_id: conversation } : {}),
			});
			return { explain: { subject: nodeId || problem?.message || question, answer } };
		} catch (err) {
			const refusal = assistRefusal(err);
			return fail(refusalStatus(refusal), { assistRefused: refusal });
		}
	},

	/**
	 * One run with its steps. The list the page loads omits them, and opening
	 * a past run is a click, not a navigation, so it goes through an action
	 * the way the webhook page loads a delivery history.
	 */
	run: async (event) => {
		await requireUser(event);
		const client = authedClient(event);
		const data = await event.request.formData();
		const runId = String(data.get('run_id') ?? '');
		try {
			const run = await getRun(client, runId);
			return { run };
		} catch (err) {
			return fail(400, { error: actionError(err, 'Failed to load the run') });
		}
	},
};
