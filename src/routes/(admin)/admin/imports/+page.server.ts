import type { PageServerLoad, Actions } from './$types';
import { fail } from '@sveltejs/kit';
import { getSchemas } from '@lyeve-labs/client-rest';
import { authedClient, requireRole } from '$lib/server/authz';
import { actionError, actionFailure } from '$lib/server/action-error';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning } from '$lib/plugins';
import {
	IMPORT_OK,
	cancelJob,
	createTemplate,
	deleteTemplate,
	getJob,
	importGate,
	listJobs,
	listRows,
	listTemplates,
	rollbackJob,
	updateTemplate,
	type FieldMapping,
	type MappingTemplate,
	type SaveMappingTemplate,
	type ImportGate,
	type ImportJob,
	type ImportRow,
	type ImportSchema,
} from '$lib/api/bulk-import';
import { pageOf, pageWindow } from '$lib/api/list';

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
/** How many rejected rows the detail panel lists. The download has them all. */
const DETAIL_ROWS = 100;

export const load: PageServerLoad = async (event) => {
	// Re-run while an import is still going, without reloading the layouts.
	event.depends('app:imports');
	const { plugins } = await event.parent();
	const { limit, offset } = pageWindow(event.url, DEFAULT_LIMIT, MAX_LIMIT);

	const client = authedClient(event);
	let jobs: ImportJob[] = [];
	let total: number | null = null;
	let hasMore = false;
	// The shell says why the page is unavailable while its plugin does not run.
	let gate: ImportGate = notRunning(plugins, PLUGIN.bulkImport) ? { state: 'absent' } : IMPORT_OK;
	if (gate.state === 'ok') {
		try {
			const page = pageOf(await listJobs(client, limit + 1, offset), limit, offset);
			jobs = page.rows;
			total = page.total;
			hasMore = page.hasMore;
		} catch (err) {
			gate = importGate(err);
		}
	}

	const schemas: ImportSchema[] =
		gate.state === 'ok'
			? await getSchemas(client)
					.then((rows) =>
						rows
							.map((s) => ({
								name: s.name,
								fields: (s.fields ?? []).map((f) => ({
									name: f.name,
									field_type: f.field_type,
									system: (f as { system?: boolean }).system,
								})),
							}))
							.sort((a, b) => a.name.localeCompare(b.name))
					)
					.catch(() => [])
			: [];

	// The job the history's Rows button opened, with the rows it rejected
	// and skipped. Read here so the panel is a link, not a script.
	let detail: { job: ImportJob; rejected: ImportRow[]; rejectedTotal: number; skipped: ImportRow[]; skippedTotal: number } | null = null;
	const jobId = event.url.searchParams.get('job');
	if (jobId && gate.state === 'ok') {
		try {
			const [job, rejected, skipped] = await Promise.all([
				getJob(client, jobId),
				listRows(client, jobId, 'errored', DETAIL_ROWS),
				listRows(client, jobId, 'skipped', DETAIL_ROWS),
			]);
			detail = { job, rejected: rejected.rows, rejectedTotal: rejected.total, skipped: skipped.rows, skippedTotal: skipped.total };
		} catch {
			detail = null;
		}
	}

	// The tenant's saved mappings, and whether this install may save one or
	// name a paid transform. A failed read says so in its section and never
	// reads as having none.
	const templates =
		gate.state === 'ok'
			? await listTemplates(client)
					.then((r) => ({
						rows: r?.templates ?? [],
						read: true,
						licensed: typeof r?.licensed === 'boolean' ? r.licensed : null,
					}))
					.catch(() => ({ rows: [] as MappingTemplate[], read: false, licensed: null }))
			: { rows: [] as MappingTemplate[], read: false, licensed: null };

	return {
		jobs,
		total,
		limit,
		offset,
		hasMore,
		gate,
		schemas,
		detail,
		templates: templates.rows,
		templatesRead: templates.read,
		licensed: templates.licensed as boolean | null,
	};
};

/** Reads the template drawer. A string is the message for a refused one. */
function templateBody(form: FormData): SaveMappingTemplate | string {
	const name = String(form.get('name') ?? '').trim();
	if (!name || name.length > 255) return 'Name the template, in at most 255 characters.';
	const contentType = String(form.get('content_type') ?? '').trim();
	if (!contentType) return 'Choose the content type the template maps onto.';
	const mode = form.get('mode') === 'upsert' ? 'upsert' : 'create';
	const upsertKey = String(form.get('upsert_key') ?? '').trim();
	if (mode === 'upsert' && !upsertKey) return 'Create and update needs the key field that finds the entry.';
	let mappings: FieldMapping[];
	try {
		mappings = JSON.parse(String(form.get('mappings') ?? '[]')) as FieldMapping[];
	} catch {
		return 'The mapping could not be read.';
	}
	if (!Array.isArray(mappings) || mappings.length === 0) return 'Map at least one column.';
	if (mappings.length > 500) return 'A template maps at most 500 columns.';
	if (mappings.some((m) => !m || typeof m.source_field !== 'string' || !m.source_field.trim() || !m.target_field)) {
		return 'Every mapping names a column in the file and the field it fills.';
	}
	return {
		name,
		content_type: contentType,
		mode,
		...(upsertKey ? { upsert_key: upsertKey } : {}),
		field_mappings: mappings,
	};
}

async function saveTemplate(event: Parameters<Actions[string]>[0], id: string | null) {
	await requireRole(event, ['admin', 'super_admin']);
	const form = await event.request.formData();
	const body = templateBody(form);
	if (typeof body === 'string') return fail(400, { error: body });
	try {
		if (id) await updateTemplate(authedClient(event), id, body);
		else await createTemplate(authedClient(event), body);
	} catch (err) {
		return actionFailure(err, 'The template could not be saved.');
	}
	return { savedTemplate: body.name };
}

export const actions: Actions = {
	createTemplate: (event) => saveTemplate(event, null),

	updateTemplate: async (event) => {
		const form = await event.request.clone().formData();
		const id = String(form.get('id') ?? '');
		if (!id) return fail(400, { error: 'No template was named.' });
		return saveTemplate(event, id);
	},

	// Deleting a template is always allowed.
	deleteTemplate: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		const form = await event.request.formData();
		const id = String(form.get('id') ?? '');
		if (!id) return fail(400, { error: 'No template was named.' });
		try {
			await deleteTemplate(authedClient(event), id);
		} catch (err) {
			return actionFailure(err, 'The template could not be deleted.');
		}
		return { removedTemplate: id };
	},

	cancel: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		const client = authedClient(event);
		const form = await event.request.formData();
		const id = String(form.get('id') ?? '');
		if (!id) return fail(400, { error: 'No import was named.' });
		try {
			await cancelJob(client, id);
		} catch (err) {
			return fail(400, { error: actionError(err, 'The import could not be canceled.') });
		}
		return { canceled: id };
	},

	// Removes the entries the job created. Offered only where there is one to
	// remove, since a dry run wrote nothing and a rollback of one would be a
	// no-op dressed as a repair.
	rollback: async (event) => {
		await requireRole(event, ['super_admin']);
		const client = authedClient(event);
		const form = await event.request.formData();
		const id = String(form.get('id') ?? '');
		if (!id) return fail(400, { error: 'No import was named.' });
		try {
			await rollbackJob(client, id);
		} catch (err) {
			return fail(400, { error: actionError(err, 'The import could not be rolled back.') });
		}
		return { rolledBack: id };
	},
};
