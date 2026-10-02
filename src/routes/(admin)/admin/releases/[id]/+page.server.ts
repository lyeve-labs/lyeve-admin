import type { Actions, PageServerLoad } from './$types';
import { error, fail, redirect } from '@sveltejs/kit';
import { ApiError, type HttpClient } from '@lyeve-labs/client';
import { authedClient, requireUser } from '$lib/server/authz';
import { actionError, actionFailure } from '$lib/server/action-error';
import { gateOf } from '$lib/api/gate';
import {
	addReleaseItem,
	cancelRelease,
	conflictsOf,
	deleteRelease,
	getRelease,
	publishRelease,
	releaseConflicts,
	removeReleaseItem,
	scheduleRelease,
	unscheduleRelease,
	updateRelease,
	type ReleaseConflict,
} from '$lib/api/content-releases';

/** What a row of the release names, read from the entry itself. */
export interface EntryLabel {
	title: string;
	schema: string;
	status: string;
}

// A release holds up to 500 entries. The page names the first hundred and
// shows the rest by id, so one load never fans out past that.
const NAMED = 100;

async function entryLabel(client: HttpClient, id: string): Promise<EntryLabel | null> {
	try {
		const e = await client.get<{ title?: unknown; schema?: unknown; status?: unknown }>(
			`/api/admin/content/${encodeURIComponent(id)}`,
		);
		return {
			title: typeof e.title === 'string' ? e.title : '',
			schema: typeof e.schema === 'string' ? e.schema : '',
			status: typeof e.status === 'string' ? e.status : '',
		};
	} catch {
		return null;
	}
}

export const load: PageServerLoad = async (event) => {
	const client = authedClient(event);
	let release;
	try {
		release = await getRelease(client, event.params.id);
	} catch (err) {
		if (err instanceof ApiError && err.status === 404) error(404, 'Release not found');
		const gate = gateOf(err, 'The release could not be read.');
		return { release: null, gate, conflicts: [] as ReleaseConflict[], conflictsRead: false, labels: {} as Record<string, EntryLabel | null> };
	}
	const items = release.items ?? [];
	const [conflicts, named] = await Promise.all([
		releaseConflicts(client, release.id)
			.then((c) => ({ rows: c, read: true }))
			.catch(() => ({ rows: [] as ReleaseConflict[], read: false })),
		Promise.all(items.slice(0, NAMED).map(async (it) => [it.entry_id, await entryLabel(client, it.entry_id)] as const)),
	]);
	return {
		release,
		gate: { state: 'ok' } as const,
		conflicts: conflicts.rows,
		conflictsRead: conflicts.read,
		labels: Object.fromEntries(named) as Record<string, EntryLabel | null>,
	};
};

/**
 * The failure for a schedule or a publish. A 409 carries the conflicts that
 * stopped it, which the page lists against the entries they name.
 */
function goOutFailure(err: unknown, fallback: string) {
	const conflicts = conflictsOf(err);
	if (conflicts) {
		return fail(409, { error: actionError(err, fallback), conflicts });
	}
	return actionFailure(err, fallback);
}


export const actions: Actions = {
	update: async (event) => {
		await requireUser(event);
		const form = await event.request.formData();
		const name = String(form.get('name') ?? '').trim();
		const description = String(form.get('description') ?? '').trim();
		if (!name) return fail(400, { error: 'Check the highlighted fields.', fields: { name: 'Name is required' } });
		try {
			await updateRelease(authedClient(event), event.params.id, { name, description });
		} catch (err) {
			return actionFailure(err, 'The release could not be saved.');
		}
		return { saved: true };
	},

	addItem: async (event) => {
		await requireUser(event);
		const form = await event.request.formData();
		const entryId = String(form.get('entry_id') ?? '').trim();
		const action = String(form.get('action') ?? '');
		if (!entryId) return fail(400, { error: 'Check the highlighted fields.', fields: { entry_id: 'Entry ID is required' } });
		if (action !== 'publish' && action !== 'unpublish') {
			return fail(400, { error: 'An entry is either published or unpublished by the release.' });
		}
		try {
			await addReleaseItem(authedClient(event), event.params.id, entryId, action);
		} catch (err) {
			return actionFailure(err, 'The entry could not be added.');
		}
		return { added: entryId };
	},

	removeItem: async (event) => {
		await requireUser(event);
		const form = await event.request.formData();
		const entryId = String(form.get('entry_id') ?? '').trim();
		if (!entryId) return fail(400, { error: 'No entry was named.' });
		try {
			await removeReleaseItem(authedClient(event), event.params.id, entryId);
		} catch (err) {
			return actionFailure(err, 'The entry could not be removed.');
		}
		return { removed: entryId };
	},

	schedule: async (event) => {
		await requireUser(event);
		const form = await event.request.formData();
		// The browser converts the picked local time to UTC, because the server
		// does not know the operator's time zone.
		const at = String(form.get('publish_at') ?? '').trim();
		if (!at || Number.isNaN(Date.parse(at))) {
			return fail(400, { error: 'Check the highlighted fields.', fields: { publish_at: 'Pick when the release goes out' } });
		}
		try {
			await scheduleRelease(authedClient(event), event.params.id, new Date(at).toISOString());
		} catch (err) {
			return goOutFailure(err, 'The release could not be scheduled.');
		}
		return { scheduled: true };
	},

	unschedule: async (event) => {
		await requireUser(event);
		try {
			await unscheduleRelease(authedClient(event), event.params.id);
		} catch (err) {
			return actionFailure(err, 'The schedule could not be removed.');
		}
		return { unscheduled: true };
	},

	publish: async (event) => {
		await requireUser(event);
		try {
			await publishRelease(authedClient(event), event.params.id);
		} catch (err) {
			return goOutFailure(err, 'The release could not be published.');
		}
		return { published: true };
	},

	cancel: async (event) => {
		await requireUser(event);
		try {
			await cancelRelease(authedClient(event), event.params.id);
		} catch (err) {
			return actionFailure(err, 'The release could not be canceled.');
		}
		return { canceled: true };
	},

	delete: async (event) => {
		await requireUser(event);
		try {
			await deleteRelease(authedClient(event), event.params.id);
		} catch (err) {
			return actionFailure(err, 'The release could not be deleted.');
		}
		redirect(303, '/admin/releases');
	},
};


