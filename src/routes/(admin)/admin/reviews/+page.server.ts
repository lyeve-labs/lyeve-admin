import type { PageServerLoad, Actions } from './$types';
import { fail } from '@sveltejs/kit';
import { ApiError } from '@lyeve-labs/client';
import { getSchemas } from '@lyeve-labs/client-rest';
import { authedClient, requireRole } from '$lib/server/authz';
import { parseStages } from '$lib/review/definition-form';
import { actionError, actionFailure } from '$lib/server/action-error';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning } from '$lib/plugins';
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
export type DefinitionRow = { definition: ReviewDefinition; stages: ReviewStage[] };

/** The engine's page size for the assignment list. */
const LIMIT = 50;

/** What the page renders. */
export type ReviewsPage = {
	operator: boolean;
	definitions: DefinitionRow[];
	/**
	 * What the definitions read says this install allows: the paid stage
	 * settings and the workflow ceiling. Null when the read carried neither.
	 */
	limits: ReviewLimits | null;
	/** The engine refused the definition list to this caller. */
	definitionsForbidden: boolean;
	assignments: ReviewAssignment[];
	total: number;
	offset: number;
	limit: number;
	status: string;
	/** The engine refused the assignment list: no read rule on reviews. */
	assignmentsForbidden: boolean;
	unavailable: boolean;
	schemas: string[];
};

function forbidden(err: unknown): boolean {
	return err instanceof ApiError && err.status === 403;
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
			getDefinition(client, definition.id).catch((): DefinitionRow => ({ definition, stages: [] })),
		),
	);
	return { rows, limits };
}

export const load: PageServerLoad = async (event) => {
	const { user, plugins } = await event.parent();
	const operator = user.roles.includes('admin') || user.roles.includes('super_admin');
	const status = event.url.searchParams.get('status') ?? '';
	const offset = Math.max(0, Number(event.url.searchParams.get('offset')) || 0);
	const page: ReviewsPage = {
		operator,
		definitions: [],
		limits: null,
		definitionsForbidden: false,
		assignments: [],
		total: 0,
		offset,
		limit: LIMIT,
		status: (REVIEW_STATUSES as readonly string[]).includes(status) ? status : '',
		assignmentsForbidden: false,
		unavailable: false,
		schemas: [],
	};
	// The shell says why the page is unavailable while its plugin does not run.
	if (notRunning(plugins, PLUGIN.review)) return page;

	const client = authedClient(event);
	const [definitions, assignments, schemas] = await Promise.all([
		operator
			? loadDefinitions(client).then(
					(read) => ({ ...read, forbidden: false, failed: false }),
					(err) => ({ rows: [] as DefinitionRow[], limits: null, forbidden: forbidden(err), failed: !forbidden(err) }),
				)
			: Promise.resolve({ rows: [] as DefinitionRow[], limits: null, forbidden: false, failed: false }),
		listAssignments(client, { status: page.status || undefined, limit: LIMIT, offset }).then(
			(res) => ({ ...res, forbidden: false, failed: false }),
			(err) => ({ items: [] as ReviewAssignment[], total: 0, forbidden: forbidden(err), failed: !forbidden(err) }),
		),
		operator ? getSchemas(client).catch(() => []) : Promise.resolve([]),
	]);

	page.definitions = definitions.rows;
	page.limits = definitions.limits;
	page.definitionsForbidden = definitions.forbidden;
	page.assignments = assignments.items;
	page.total = Math.max(assignments.total, offset + assignments.items.length);
	page.assignmentsForbidden = assignments.forbidden;
	page.unavailable = definitions.failed || assignments.failed;
	page.schemas = schemas.map((s) => s.name);
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
		if (!name) return fail(400, { error: 'Check the highlighted fields.', fields: { name: 'Name is required' } });
		const parsed = parseStages(String(form.get('stages') ?? '[]'));
		if ('error' in parsed) return fail(400, { error: parsed.error });
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
			return actionFailure(err, 'Failed to create the definition.');
		}
		return { created: true };
	},

	delete: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		const form = await event.request.formData();
		const id = String(form.get('id') ?? '').trim();
		if (!id) return fail(400, { error: 'Pick a definition to delete.' });
		try {
			await deleteDefinition(authedClient(event), id);
		} catch (err) {
			return fail(400, { error: actionError(err, 'Failed to delete the definition.') });
		}
		return { deleted: true };
	},
};

