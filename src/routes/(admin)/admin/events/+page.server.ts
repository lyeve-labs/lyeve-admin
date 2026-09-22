import type { PageServerLoad, Actions } from './$types';
import { fail } from '@sveltejs/kit';
import { authedClient, requireRole } from '$lib/server/authz';
import { actionError } from '$lib/server/action-error';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning } from '$lib/plugins';
import {
	EVENTS_OK,
	eventsGate,
	listEvents,
	listReplays,
	startReplay,
	type EventRow,
	type EventsGate,
	type ReplayRun,
} from '$lib/api/events';
import { pageWindow } from '$lib/api/list';
import { instantFromWallClock } from '$lib/utils/wall-clock';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 199;

/** How many runs the panel beside the log shows. */
const REPLAY_LIMIT = 10;

export const load: PageServerLoad = async (event) => {
	const { plugins } = await event.parent();
	const { limit, offset } = pageWindow(event.url, DEFAULT_LIMIT, MAX_LIMIT);

	// The shell says why the page is unavailable while its plugin does not run.
	if (notRunning(plugins, PLUGIN.events)) {
		return {
			events: [] as EventRow[],
			runs: [] as ReplayRun[],
			total: 0,
			limit,
			offset,
			gate: { state: 'absent' } as EventsGate,
		};
	}

	const client = authedClient(event);
	let events: EventRow[] = [];
	let total = 0;
	let gate: EventsGate = EVENTS_OK;
	try {
		const page = await listEvents(client, limit, offset);
		events = page.data ?? [];
		total = Math.max(page.total_count ?? 0, offset + events.length);
	} catch (err) {
		gate = eventsGate(err);
	}

	// The run list is a panel beside the log. Losing it should not lose the
	// log, which is the page's subject.
	const runs =
		gate.state === 'ok'
			? await listReplays(client, REPLAY_LIMIT, 0)
					.then((p) => p.data ?? [])
					.catch(() => [])
			: [];

	return { events, runs, total, limit, offset, gate };
};

export const actions: Actions = {
	replay: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		const client = authedClient(event);
		const form = await event.request.formData();

		const since = String(form.get('since') ?? '').trim();
		const handler = String(form.get('handler') ?? '').trim();
		// The checkbox is absent when it is cleared, and absent must mean a
		// real replay only when the operator cleared it on purpose. The form
		// posts an explicit value so a missing field cannot fire one.
		const dryRun = String(form.get('dry_run') ?? '') !== 'false';

		if (!since) {
			return fail(400, { error: 'Choose the point to replay from.', fields: { since: 'Required' } });
		}
		const from = instantFromWallClock(since, String(form.get('since_offset') ?? ''));
		if (!from) {
			return fail(400, { error: 'That is not a time the log can be replayed from.' });
		}
		if (from.getTime() > Date.now()) {
			// The log holds what was published, so a window that starts in the
			// future matches nothing and reads as a silent no-op.
			return fail(400, { error: 'A replay starts in the past. Nothing has been published yet after that point.' });
		}

		try {
			const run = await startReplay(client, {
				since: from.toISOString(),
				handler: handler || undefined,
				dry_run: dryRun,
			});
			return { started: run.run_id, dryRun };
		} catch (err) {
			return fail(400, { error: actionError(err, 'The replay could not be started.') });
		}
	},
};
