import type { PageServerLoad, Actions } from './$types';
import { fail } from '@sveltejs/kit';
import { getSchemas } from '@lyeve-labs/client-rest';
import { authedClient, requireRole } from '$lib/server/authz';
import { actionError } from '$lib/server/action-error';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning } from '$lib/plugins';
import {
	EXPORT_OK,
	cancelJob,
	createSchedule,
	deleteSchedule,
	exportGate,
	listJobs,
	listSchedules,
	setScheduleEnabled,
	startExport,
	type ExportGate,
	type ExportJob,
	type ExportSchedule,
} from '$lib/api/data-export';
import { exportConfigFrom } from '$lib/data-export-form';
import { pageWindow } from '$lib/api/list';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 199;

export const load: PageServerLoad = async (event) => {
	// The page re-runs this while an export is still going, so it names the
	// dependency it invalidates rather than reloading every layout above it.
	event.depends('app:data-export');
	const { plugins } = await event.parent();
	const { limit, offset } = pageWindow(event.url, DEFAULT_LIMIT, MAX_LIMIT);

	// The shell says why the page is unavailable while its plugin does not run.
	if (notRunning(plugins, PLUGIN.dataExport)) {
		return {
			jobs: [] as ExportJob[],
			schedules: [] as ExportSchedule[],
			schemas: [] as string[],
			total: 0,
			limit,
			offset,
			gate: { state: 'absent' } as ExportGate,
		};
	}

	const client = authedClient(event);
	let jobs: ExportJob[] = [];
	let total = 0;
	let gate: ExportGate = EXPORT_OK;
	try {
		const page = await listJobs(client, limit, offset);
		jobs = page.data;
		total = Math.max(page.total_count, offset + jobs.length);
	} catch (err) {
		gate = exportGate(err);
	}

	// Schedules and the schema list are panels beside the jobs. Losing them
	// should not lose the jobs, which are what an operator came to check.
	const [schedules, schemas] =
		gate.state === 'ok'
			? await Promise.all([
					listSchedules(client)
						.then((p) => p.data)
						.catch(() => [] as ExportSchedule[]),
					getSchemas(client)
						.then((rows) => rows.map((s) => s.name).sort((a, b) => a.localeCompare(b)))
						.catch(() => [] as string[]),
				])
			: [[] as ExportSchedule[], [] as string[]];

	return { jobs, schedules, schemas, total, limit, offset, gate };
};

export const actions: Actions = {
	start: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		const client = authedClient(event);
		const form = await event.request.formData();

		const name = String(form.get('name') ?? '').trim();
		if (!name) {
			return fail(400, { error: 'Name the export so it can be told apart in the list.' });
		}
		const config = exportConfigFrom(form);
		if ('error' in config) return fail(400, { error: config.error });

		try {
			const job = await startExport(client, { name, ...config.config });
			return { started: job.id };
		} catch (err) {
			return fail(400, { error: actionError(err, 'The export could not be started.') });
		}
	},

	cancel: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		const client = authedClient(event);
		const form = await event.request.formData();
		const id = String(form.get('id') ?? '');
		if (!id) return fail(400, { error: 'No export was named.' });
		try {
			await cancelJob(client, id);
			return { canceled: id };
		} catch (err) {
			return fail(400, { error: actionError(err, 'The export could not be canceled.') });
		}
	},

	createSchedule: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		const client = authedClient(event);
		const form = await event.request.formData();

		const name = String(form.get('name') ?? '').trim();
		const cron = String(form.get('cron_expression') ?? '').trim();
		if (!name) return fail(400, { error: 'Name the schedule so its exports can be told apart.' });
		if (!cron) return fail(400, { error: 'Say when the schedule runs.' });
		const config = exportConfigFrom(form);
		if ('error' in config) return fail(400, { error: config.error });

		try {
			await createSchedule(client, {
				name,
				cron_expression: cron,
				enabled: form.get('enabled') === 'true',
				export_config: config.config,
			});
			return { scheduled: name };
		} catch (err) {
			return fail(400, { error: actionError(err, 'The schedule could not be created.') });
		}
	},

	toggleSchedule: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		const client = authedClient(event);
		const form = await event.request.formData();
		const id = String(form.get('id') ?? '');
		if (!id) return fail(400, { error: 'No schedule was named.' });
		const enabled = form.get('enabled') === 'true';
		try {
			await setScheduleEnabled(client, id, enabled);
			return { toggled: id, enabled };
		} catch (err) {
			return fail(400, { error: actionError(err, 'The schedule could not be changed.') });
		}
	},

	deleteSchedule: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		const client = authedClient(event);
		const form = await event.request.formData();
		const id = String(form.get('id') ?? '');
		if (!id) return fail(400, { error: 'No schedule was named.' });
		try {
			await deleteSchedule(client, id);
			return { deleted: id };
		} catch (err) {
			return fail(400, { error: actionError(err, 'The schedule could not be deleted.') });
		}
	},
};
