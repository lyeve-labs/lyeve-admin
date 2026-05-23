import type { PageServerLoad, Actions } from './$types';
import { error, fail, redirect } from '@sveltejs/kit';
import { createClient } from '@lyeve-labs/client';
import { authedClient, requireRole } from '$lib/server/authz';
import { actionError, actionFailure } from '$lib/server/action-error';
import { alertsFrom, type AlertConfig } from '$lib/api/cron-alerts';
import { pageOf, pageWindow, pastEndOffset, withOffset } from '$lib/api/list';
import { sessionToken } from '$lib/server/session-cookie';

export interface Job {
	id: string;
	name: string;
	description: string;
	schedule: string;
	endpoint: string;
	payload: Record<string, unknown> | null;
	enabled: boolean;
	last_run_at: string | null;
	last_status: string | null;
	created_at: string;
	updated_at: string;
	/** Failure alerts, absent when the engine does not send them. */
	alerts?: AlertConfig | null;
	consecutive_failures?: number;
}

/** The page size when a request names none. */
const DEFAULT_LIMIT = 50;

/**
 * One below the engine's list ceiling, because the request below asks for a row
 * past the page to learn whether another page exists. At the ceiling that extra
 * row would be clamped away and the last page would always look like the last
 * page.
 */
const MAX_LIMIT = 199;

async function listJobs(
	client: ReturnType<typeof createClient>,
	limit: number,
	offset: number
): Promise<Job[]> {
	try {
		// GET /api/admin/jobs returns a bare array. Reading a `jobs` wrapper that
		// is not there resolves to undefined and renders an empty list.
		const res = await client.get<Job[] | { jobs: Job[] }>(
			`/api/admin/jobs?limit=${limit}&offset=${offset}`
		);
		return Array.isArray(res) ? res : (res?.jobs ?? []);
	} catch {
		return [];
	}
}

export const load: PageServerLoad = async ({ fetch, cookies, url, parent }) => {
	const { user } = await parent();
	if (!user.roles.includes('super_admin')) error(403, 'Requires super_admin role');
	const token = sessionToken({ cookies, url }) ?? '';
	const client = createClient(fetch, { Authorization: `Bearer ${token}` });
	const { limit, offset } = pageWindow(url, DEFAULT_LIMIT, MAX_LIMIT);

	/*
	 * Neither shape this endpoint answers with carries a row count, so there is
	 * no collection total to state and a numbered pager could only be built by
	 * inventing one. The extra row asked for here is a probe: it says whether a
	 * next page exists and nothing more, and it is dropped before the page sees
	 * it.
	 */
	const rows = await listJobs(client, limit + 1, offset);
	const page = pageOf<Job>(rows, limit, offset);
	const back = pastEndOffset(page.rows.length, limit, offset, null);
	if (back !== null) redirect(307, withOffset(url, back));

	// The drawer is addressable. `?new=1` opens it empty and `?edit=<id>` opens
	// it on that job, which is how the dashboard's "Open job" link lands on the
	// list. A job off this page is read on its own so the link still opens it.
	const openNew = url.searchParams.get('new') === '1';
	const editId = url.searchParams.get('edit');
	let openJob: Job | null = null;
	if (editId) {
		openJob = page.rows.find((j) => j.id === editId) ?? (await readJob(client, editId));
	}
	return { jobs: page.rows, limit, offset, hasMore: page.hasMore, openNew, openJob };
};

async function readJob(client: ReturnType<typeof createClient>, id: string): Promise<Job | null> {
	try {
		// GET /api/admin/jobs/{id} returns the job itself. Reading a `job`
		// wrapper that is not there yields undefined, and the edit form would
		// render every field blank for a job that exists.
		const res = await client.get<Job | { job: Job }>(`/api/admin/jobs/${encodeURIComponent(id)}`);
		const job = 'job' in res ? res.job : res;
		return job?.id ? job : null;
	} catch {
		return null;
	}
}

/** The body both writes send, or the one sentence that stops them. */
function jobBody(form: FormData): { body: Record<string, unknown> } | { error: string } {
	const body: Record<string, unknown> = {
		name: String(form.get('name') ?? '').trim(),
		description: String(form.get('description') ?? '').trim(),
		schedule: String(form.get('schedule') ?? '').trim(),
		endpoint: String(form.get('endpoint') ?? '').trim(),
		enabled: form.get('enabled') === 'on',
		payload: null,
	};
	const payloadRaw = String(form.get('payload') ?? '').trim();
	if (payloadRaw) {
		try {
			body.payload = JSON.parse(payloadRaw);
		} catch {
			return { error: 'Payload must be valid JSON.' };
		}
	}
	if (!body.name || !body.schedule || !body.endpoint) {
		return { error: 'Name, schedule, and endpoint are required' };
	}
	const alerts = alertsFrom(form);
	if (alerts !== undefined) body.alerts = alerts;
	return { body };
}

/** A job write's answer, which carries the webhook signing secret only once. */
type SavedJob = { name?: string; alert_signing_secret?: string } | undefined;

/**
 * The write that sets a new alert webhook is the only answer that carries its
 * signing secret, so the page shows it instead of redirecting past it.
 */
function signingReveal(saved: NonNullable<SavedJob>) {
	return { signingFor: String(saved.name ?? ''), signingSecret: String(saved.alert_signing_secret) };
}

export const actions: Actions = {
	create: async (event) => {
		await requireRole(event, ['super_admin']);
		const client = authedClient(event);
		const parsed = jobBody(await event.request.formData());
		if ('error' in parsed) return fail(400, { error: parsed.error });
		let saved: SavedJob;
		try {
			saved = await client.post<SavedJob>('/api/admin/jobs', parsed.body);
		} catch (err) {
			return actionFailure(err, 'Failed to create job.');
		}
		if (saved?.alert_signing_secret) return signingReveal(saved);
		redirect(303, '/admin/jobs');
	},

	update: async (event) => {
		await requireRole(event, ['super_admin']);
		const client = authedClient(event);
		const form = await event.request.formData();
		const id = String(form.get('id') ?? '');
		if (!id) return fail(400, { error: 'Missing job id' });
		const parsed = jobBody(form);
		if ('error' in parsed) return fail(400, { error: parsed.error });
		let saved: SavedJob;
		try {
			saved = await client.put<SavedJob>(`/api/admin/jobs/${encodeURIComponent(id)}`, parsed.body);
		} catch (err) {
			return actionFailure(err, 'Failed to update job.');
		}
		if (saved?.alert_signing_secret) return signingReveal(saved);
		redirect(303, '/admin/jobs');
	},

	delete: async (event) => {
		await requireRole(event, ['super_admin']);
		const { request } = event;
		const client = authedClient(event);
		const form = await request.formData();
		const id = form.get('id') as string;
		if (!id) return fail(400, { error: 'Missing job id' });
		try {
			await client.delete(`/api/admin/jobs/${encodeURIComponent(id)}`);
		} catch (err) {
			return fail(400, { error: actionError(err, 'Failed to delete job.') });
		}
		redirect(303, '/admin/jobs');
	},
};
