import type { PageServerLoad, Actions } from './$types';
import { fail } from '@sveltejs/kit';
import { authedClient, requireRole } from '$lib/server/authz';
import { actionError, actionFailure } from '$lib/server/action-error';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning } from '$lib/plugins';
import {
	ALERT_STATUSES,
	ERROR_OK,
	acknowledge,
	assign,
	errorGate,
	isTriageAction,
	listAlerts,
	listCodes,
	listEvents,
	triage,
	type AlertStatus,
	type ErrorAlert,
	type ErrorCode,
	type ErrorGate,
	type EventPage,
} from '$lib/api/error-tracking';
import { pageWindow, rowsOf } from '$lib/api/list';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/** How many of the newest events the page lists under the alerts. */
const EVENT_LIMIT = 20;

function statusFilter(url: URL): AlertStatus | '' {
	const s = url.searchParams.get('status') ?? '';
	return (ALERT_STATUSES as readonly string[]).includes(s) ? (s as AlertStatus) : '';
}

export const load: PageServerLoad = async (event) => {
	const { plugins } = await event.parent();
	const { limit, offset } = pageWindow(event.url, DEFAULT_LIMIT, MAX_LIMIT);
	const status = statusFilter(event.url);

	const client = authedClient(event);
	let alerts: ErrorAlert[] = [];
	let total: number | null = null;
	// The shell says why the page is unavailable while its plugin does not run.
	let gate: ErrorGate = notRunning(plugins, PLUGIN.errorTracking) ? { state: 'absent' } : ERROR_OK;
	if (gate.state === 'ok') {
		try {
			// This route answers its own envelope shape rather than the usual
			// one, so it is unwrapped here instead of through pageOf.
			const page = await listAlerts(client, limit, offset, status);
			alerts = page.alerts ?? [];
			total = typeof page.total === 'number' ? page.total : null;
		} catch (err) {
			gate = errorGate(err);
		}
	}

	// The catalog gives each fingerprint its severity and its remediation
	// text. Losing it costs the labels, never the list.
	const codes =
		gate.state === 'ok'
			? await listCodes(client)
					.then((c) => rowsOf(c))
					.catch((): ErrorCode[] => [])
			: [];

	// The newest occurrences, and how many older ones this install does not
	// read. Losing them costs the band, never the alert list, and a failed
	// read is said as one rather than as no events.
	const events: EventPage | null =
		gate.state === 'ok' ? await listEvents(client, EVENT_LIMIT).catch(() => null) : null;

	return { alerts, codes, total, limit, offset, gate, status, events };
};

export const actions: Actions = {
	acknowledge: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		const client = authedClient(event);
		const form = await event.request.formData();
		const id = String(form.get('id') ?? '');
		if (!id) return fail(400, { error: 'No alert was named.' });
		try {
			await acknowledge(client, id);
		} catch (err) {
			return fail(400, { error: actionError(err, 'The alert could not be acknowledged.') });
		}
		return { acknowledged: id };
	},

	/** Resolve, ignore or reopen one alert. Triage works on every install. */
	triage: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		const form = await event.request.formData();
		const id = String(form.get('id') ?? '');
		const action = form.get('action');
		if (!id || !isTriageAction(action)) return fail(400, { error: 'Pick an alert and what to do with it.' });
		try {
			await triage(authedClient(event), id, action);
		} catch (err) {
			return actionFailure(err, 'The alert could not be changed.');
		}
		return { triaged: id, action };
	},

	/** Assign an alert to somebody, or clear the assignee with an empty one. */
	assign: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		const form = await event.request.formData();
		const id = String(form.get('id') ?? '');
		const assignee = String(form.get('assignee') ?? '').trim();
		if (!id) return fail(400, { error: 'No alert was named.' });
		if (assignee.length > 255) return fail(400, { error: 'An assignee is at most 255 characters.' });
		try {
			await assign(authedClient(event), id, assignee);
		} catch (err) {
			return actionFailure(err, 'The alert could not be assigned.');
		}
		return { assigned: id, assignee };
	},
};
