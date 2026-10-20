import type { PageServerLoad, Actions } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { getSchemas } from '@lyeve-labs/client-rest';
import { authedClient, requireRole } from '$lib/server/authz';
import { parseStages } from '$lib/review/definition-form';
import { actionError, actionFailure } from '$lib/server/action-error';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning } from '$lib/plugins';
import { section, type Section } from '$lib/api/gate';
import { pageOffset, pageNumber, pastEndOffset, withOffset } from '$lib/api/list';
import { listPeople } from '$lib/server/people';
import { entryTitle } from '$lib/utils/entry-identity';
import {
	createDefinition,
	deleteDefinition,
	getDefinition,
	listAssignments,
	listDefinitions,
	REVIEW_STATUSES,
	type ReviewAssignment,
	type ReviewDefinition,
	type ReviewLimits,
	type ReviewStage,
} from '$lib/api/review';

/** A definition with the stages the list route leaves out. */
/** A definition and its stages. Stages are null when their read failed, which is never a definition with none. */
export type DefinitionRow = { definition: ReviewDefinition; stages: ReviewStage[] | null };

/** The engine's page size for the assignment list. */
const LIMIT = 50;

/** What the page renders. */
export type ReviewsPage = {
	operator: boolean;
	/** The definitions with their stages. Read for an operator only. */
	definitions: Section<DefinitionRow[]>;
	/**
	 * What the definitions read says this install allows: the paid stage
	 * settings and the workflow ceiling. Null when the read carried neither.
	 */
	limits: ReviewLimits | null;
	assignments: Section<ReviewAssignment[]>;
	total: number;
	offset: number;
	limit: number;
	status: string;
	/** The schemas a definition can review. Read for an operator only. */
	schemas: Section<string[]>;
	/** Each listed entry's title by its id. An entry the read missed is absent. */
	entries: Record<string, string>;
	/**
	 * Whether the titles were read at all. The content routes that hold them
	 * admit an operator only, so another reviewer's queue lists entries by id.
	 */
	entriesNamed: boolean;
	/** Each account's email by its id. An account the read missed is absent. */
	people: Record<string, string>;
};

const DEFINITIONS_FAILED = 'The review definitions could not be read. This is not a report that there are none.';
const ASSIGNMENTS_FAILED = 'The review assignments could not be read. This is not a report that nothing is under review.';
const SCHEMAS_FAILED = 'The content schemas could not be read.';

/**
 * The title each listed entry is known by. The assignment list carries only
 * the entry id, and a page holds at most LIMIT of them, so each is read once.
 * An entry the caller may not read, or one since deleted, keeps its id.
 */
async function loadEntryTitles(
	client: ReturnType<typeof authedClient>,
	ids: string[],
): Promise<Record<string, string>> {
	const named = await Promise.all(
		[...new Set(ids)].map(async (id) => {
			const entry = await client
				.get<{ title?: unknown; slug?: unknown; body?: unknown }>(`/api/admin/content/${encodeURIComponent(id)}`)
				.catch(() => null);
			if (!entry) return null;
			const data = entry.body && typeof entry.body === 'object' ? (entry.body as Record<string, unknown>) : undefined;
			const { label } = entryTitle({ id, title: entry.title, slug: entry.slug, data });
			return label ? ([id, label] as const) : null;
		}),
	);
	return Object.fromEntries(named.filter((n) => n !== null));
}

/**
 * The definitions with their stages. The list route answers the definition
 * rows alone and the stages come one definition at a time. A tenant holds a
 * handful, so the reads run together.
 */
async function loadDefinitions(
	client: ReturnType<typeof authedClient>,
): Promise<{ rows: DefinitionRow[]; limits: ReviewLimits | null }> {
	const { items, limits } = await listDefinitions(client, 100, 0);
	const rows = await Promise.all(
		items.map((definition) =>
			getDefinition(client, definition.id).catch((): DefinitionRow => ({ definition, stages: null })),
		),
	);
	return { rows, limits };
}

export const load: PageServerLoad = async (event) => {
	const { user, plugins } = await event.parent();
	const operator = user.roles.includes('admin') || user.roles.includes('super_admin');
	const status = event.url.searchParams.get('status') ?? '';
	// The pager counts in pages, so an offset between two boundaries snaps
	// down onto the page that holds it.
	const offset = pageOffset(pageNumber(Math.max(0, Number(event.url.searchParams.get('offset')) || 0), LIMIT), LIMIT);
	const none: Section<never[]> = { ok: true, value: [] };
	const page: ReviewsPage = {
		operator,
		definitions: none,
		limits: null,
		assignments: none,
		total: 0,
		offset,
		limit: LIMIT,
		status: (REVIEW_STATUSES as readonly string[]).includes(status) ? status : '',
		schemas: none,
		entries: {},
		entriesNamed: operator,
		people: {},
	};
	// The shell says why the page is unavailable while its plugin does not run.
	if (notRunning(plugins, PLUGIN.review)) return page;

	const client = authedClient(event);
	const [definitions, assignments, schemas, people] = await Promise.all([
		operator
			? section(loadDefinitions(client), DEFINITIONS_FAILED)
			: Promise.resolve<Section<{ rows: DefinitionRow[]; limits: ReviewLimits | null }>>({
					ok: true,
					value: { rows: [], limits: null },
				}),
		section(listAssignments(client, { status: page.status || undefined, limit: LIMIT, offset }), ASSIGNMENTS_FAILED),
		operator
			? section(
					getSchemas(client).then((rows) => rows.map((s) => s.name)),
					SCHEMAS_FAILED,
				)
			: Promise.resolve<Section<string[]>>({ ok: true, value: [] }),
		// The directory is an operator's to read. A reviewer sees their own
		// email and the ids of everyone else.
		operator ? listPeople(client) : Promise.resolve([]),
	]);

	if (assignments.ok) {
		const rows = assignments.value.items;
		const back = pastEndOffset(rows.length, LIMIT, offset, assignments.value.total);
		if (back !== null) redirect(307, withOffset(event.url, back));
		page.assignments = { ok: true, value: rows };
		page.total = Math.max(assignments.value.total, offset + rows.length);
		// Titles come from the content routes, which refuse every role but an
		// operator. Asking for them on another reader's behalf would only
		// collect a refusal per row.
		if (operator) page.entries = await loadEntryTitles(client, rows.map((a) => a.entry_id));
	} else {
		page.assignments = assignments;
	}
	if (definitions.ok) {
		page.definitions = { ok: true, value: definitions.value.rows };
		page.limits = definitions.value.limits;
	} else {
		page.definitions = definitions;
	}
	page.schemas = schemas;
	page.people = Object.fromEntries([
		...people.map((p) => [p.id, p.email] as const),
		...(user.email ? [[user.id, user.email] as const] : []),
	]);
	return page;
};

export const actions: Actions = {
	create: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		const form = await event.request.formData();
		const name = String(form.get('name') ?? '').trim();
		const slug = String(form.get('slug') ?? '').trim();
		const contentSchema = String(form.get('content_schema') ?? '').trim();
		const publishOnApprove = form.get('publish_on_approve') !== 'false';
		if (!name) return fail(400, { action: 'create', error: 'Check the highlighted fields.', fields: { name: 'Name is required' } });
		const parsed = parseStages(String(form.get('stages') ?? '[]'));
		if ('error' in parsed) return fail(400, { action: 'create', error: parsed.error });
		try {
			await createDefinition(authedClient(event), {
				name,
				slug: slug || undefined,
				content_schema: contentSchema,
				publish_on_approve: publishOnApprove,
				stages: parsed.stages,
			});
		} catch (err) {
			// A 402 is the workflow ceiling or a paid stage setting, and the
			// drawer renders the plugin's own numbers or capability.
			const failed = actionFailure(err, 'Failed to create the definition.');
			return fail(failed.status, { ...failed.data, action: 'create' });
		}
		return { created: true };
	},

	delete: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		const form = await event.request.formData();
		const id = String(form.get('id') ?? '').trim();
		if (!id) return fail(400, { action: 'delete', error: 'Pick a definition to delete.' });
		try {
			await deleteDefinition(authedClient(event), id);
		} catch (err) {
			return fail(400, { action: 'delete', error: actionError(err, 'Failed to delete the definition.') });
		}
		return { deleted: true };
	},
};

