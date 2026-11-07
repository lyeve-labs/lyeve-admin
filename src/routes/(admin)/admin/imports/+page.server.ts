import type { PageServerLoad, Actions } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { getSchemas } from '@lyeve-labs/client-rest';
import { authedClient, requireRole } from '$lib/server/authz';
import { actionError } from '$lib/server/action-error';
import { refusalOf, refusalText } from '$lib/api/refusal';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning } from '$lib/plugins';
import {
	cancelJob,
	createTemplate,
	deleteTemplate,
	getJob,
	listJobs,
	listRows,
	listTemplates,
	rollbackJob,
	updateTemplate,
	type FieldMapping,
	type MappingTemplate,
	type SaveMappingTemplate,
	type ImportJob,
	type ImportRow,
	type ImportSchema,
} from '$lib/api/bulk-import';
import { type Gate, GATE_OK, section, type Section } from '$lib/api/gate';
import { pageOf, pageWindow, pastEndOffset, withOffset } from '$lib/api/list';
import { couldNotLoad } from '$lib/outage';

/** The job the history's Rows button opened, with the rows it rejected and skipped. */
export interface ImportDetail {
	job: ImportJob;
	rejected: ImportRow[];
	rejectedTotal: number;
	skipped: ImportRow[];
	skippedTotal: number;
}

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
	// The shell says why the page is unavailable while its plugin does not run.
	const jobsRead = notRunning(plugins, PLUGIN.bulkImport)
		? null
		: await section(
				listJobs(client, limit + 1, offset).then((res) => pageOf(res, limit, offset)),
				couldNotLoad('imports'),
			);
	const gate: Gate = !jobsRead ? { state: 'absent' } : jobsRead.ok ? GATE_OK : jobsRead.gate;
	const page = jobsRead?.ok ? jobsRead.value : null;
	if (page) {
		const back = pastEndOffset(page.rows.length, limit, offset, page.total);
		if (back !== null) redirect(307, withOffset(event.url, back));
	}
	const jobs: ImportJob[] = page?.rows ?? [];
	const total = page?.total ?? null;
	const hasMore = page?.hasMore ?? false;

	// The content types an import fills. An unread list is kept as a failure,
	// so the wizard says why it offers none rather than offering nothing.
	const schemas: Section<ImportSchema[]> =
		gate.state === 'ok'
			? await section(
					getSchemas(client).then((rows) =>
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
					),
					couldNotLoad('content types')
				)
			: { ok: false, gate };

	// Read here so the panel is a link, not a script. A failed read still
	// opens the panel, which says why it holds no rows.
	let detail: Section<ImportDetail> | null = null;
	const jobId = event.url.searchParams.get('job');
	if (jobId && gate.state === 'ok') {
		detail = await section(
			Promise.all([
				getJob(client, jobId),
				listRows(client, jobId, 'errored', DETAIL_ROWS),
				listRows(client, jobId, 'skipped', DETAIL_ROWS),
			]).then(([job, rejected, skipped]) => ({
				job,
				rejected: rejected.rows,
				rejectedTotal: rejected.total,
				skipped: skipped.rows,
				skippedTotal: skipped.total,
			})),
			couldNotLoad('the rows of this import')
		);
	}

	// The tenant's saved mappings, and whether this install may save one or
	// name a paid transform. A failed read says so in its section and never
	// reads as having none.
	// The gate is kept, so a role refusal, a lapsed license and an outage each
	// read as what they are.
	const read =
		gate.state === 'ok'
			? await section(listTemplates(client), couldNotLoad('templates'))
			: null;
	const templates = read?.ok
		? {
				rows: read.value?.templates ?? [],
				read: true,
				licensed: typeof read.value?.licensed === 'boolean' ? read.value.licensed : null,
				gate: null,
			}
		: { rows: [] as MappingTemplate[], read: false, licensed: null, gate: read && !read.ok ? read.gate : null };

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
		templatesGate: templates.gate as Gate | null,
		licensed: templates.licensed as boolean | null,
	};
};

/** Reads the template drawer. A string is the message for a refused one. */
function templateBody(form: FormData): SaveMappingTemplate | string {
	const name = String(form.get('name') ?? '').trim();
	if (!name || name.length > 255) return 'Enter a template name of up to 255 characters.';
	const contentType = String(form.get('content_type') ?? '').trim();
	if (!contentType) return 'Choose the content type the template maps onto.';
	const mode = form.get('mode') === 'upsert' ? 'upsert' : 'create';
	const upsertKey = String(form.get('upsert_key') ?? '').trim();
	if (mode === 'upsert' && !upsertKey) return 'Choose a key field to create and update entries.';
	let mappings: FieldMapping[];
	try {
		mappings = JSON.parse(String(form.get('mappings') ?? '[]')) as FieldMapping[];
	} catch {
		return 'Could not read the mapping. Reload the page and try again.';
	}
	if (!Array.isArray(mappings) || mappings.length === 0) return 'Map at least one column.';
	if (mappings.length > 500) return 'A template can map up to 500 columns.';
	if (mappings.some((m) => !m || typeof m.source_field !== 'string' || !m.source_field.trim() || !m.target_field)) {
		return 'Give every mapping a column in the file and the field it fills.';
	}
	return {
		name,
		content_type: contentType,
		mode,
		...(upsertKey ? { upsert_key: upsertKey } : {}),
		field_mappings: mappings,
	};
}

/**
 * A failed write, tagged with the action that made it. Every form on the page
 * reports through one result, and the tag is how the template drawer tells
 * its own failure from a row action's.
 */
function failure(action: string, err: unknown, fallback: string) {
	const refused = refusalOf(err);
	if (refused) return fail(402, { action, error: refusalText(refused), refused });
	return fail(400, { action, error: actionError(err, fallback) });
}

async function saveTemplate(event: Parameters<Actions[string]>[0], id: string | null) {
	await requireRole(event, ['admin', 'super_admin']);
	const form = await event.request.formData();
	const body = templateBody(form);
	if (typeof body === 'string') return fail(400, { action: 'saveTemplate', error: body });
	try {
		if (id) await updateTemplate(authedClient(event), id, body);
		else await createTemplate(authedClient(event), body);
	} catch (err) {
		return failure('saveTemplate', err, 'Could not save the template. Try again.');
	}
	return { savedTemplate: body.name };
}

export const actions: Actions = {
	createTemplate: (event) => saveTemplate(event, null),

	updateTemplate: async (event) => {
		const form = await event.request.clone().formData();
		const id = String(form.get('id') ?? '');
		if (!id) return fail(400, { action: 'saveTemplate', error: 'This form is missing its template. Reload the page and try again.' });
		return saveTemplate(event, id);
	},

	// Deleting a template is always allowed.
	deleteTemplate: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		const form = await event.request.formData();
		const id = String(form.get('id') ?? '');
		if (!id) return fail(400, { action: 'deleteTemplate', error: 'This form is missing its template. Reload the page and try again.' });
		try {
			await deleteTemplate(authedClient(event), id);
		} catch (err) {
			return failure('deleteTemplate', err, 'Could not delete the template. Try again.');
		}
		return { removedTemplate: id };
	},

	cancel: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		const client = authedClient(event);
		const form = await event.request.formData();
		const id = String(form.get('id') ?? '');
		if (!id) return fail(400, { action: 'cancel', error: 'This form is missing its import. Reload the page and try again.' });
		try {
			await cancelJob(client, id);
		} catch (err) {
			return failure('cancel', err, 'Could not cancel the import. Try again.');
		}
		return { canceled: id };
	},

	// Removes the entries the job created. Offered only where there is one to
	// remove, since a dry run wrote nothing and a rollback of one would be a
	// no-op dressed as a repair. The engine takes it from any admin, so the
	// admin who ran a bad import can undo it.
	rollback: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		const client = authedClient(event);
		const form = await event.request.formData();
		const id = String(form.get('id') ?? '');
		if (!id) return fail(400, { action: 'rollback', error: 'This form is missing its import. Reload the page and try again.' });
		try {
			await rollbackJob(client, id);
		} catch (err) {
			return failure('rollback', err, 'Could not roll back the import. Try again.');
		}
		return { rolledBack: id };
	},
};
