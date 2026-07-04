import type { PageServerLoad, Actions } from './$types';
import { fail } from '@sveltejs/kit';
import { authedClient, requireRole } from '$lib/server/authz';
import { actionFailure } from '$lib/server/action-error';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning } from '$lib/plugins';
import {
	SYNTHETIC_OK,
	acknowledgeAlert,
	createProbe,
	deleteProbe,
	getProbeChannels,
	listOpenAlerts,
	listProbes,
	probeType,
	putProbeChannels,
	runProbeNow,
	syntheticGate,
	updateProbe,
	type Probe,
	type ProbeAlert,
	type ProbeChannels,
	type ProbeConfig,
	type SyntheticGate,
} from '$lib/api/synthetic';
import { channelsFrom, hasChannels } from '$lib/api/alert-channels';
import { gateOf, type Gate } from '$lib/api/gate';

/** What the notice channels drawer posts its fields under. */
const CHANNEL_PREFIX = 'channel_';

/**
 * The probe the channels drawer is open on, read when the address names it.
 * A refused or failed read is said in the drawer rather than as no channels.
 */
type ChannelsFor = { probe: Probe; read: ProbeChannels | null; gate: Gate } | null;
import { pageOf, pageWindow } from '$lib/api/list';

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

/**
 * Bounds the engine does not enforce.
 *
 * A probe is the instance making requests of itself on a timer, so an interval
 * of one second is a load generator with a monitoring label on it. The floor
 * is here rather than in the engine because the engine's callers include a
 * migration and a restore, which legitimately write whatever was stored.
 */
const MIN_INTERVAL_SECONDS = 30;
const MIN_TIMEOUT_SECONDS = 1;

function positive(raw: FormDataEntryValue | null, fallback: number): number {
	const n = Number(raw);
	return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/** The type-specific half of a probe, read off the one form that serves all four. */
function configFor(type: string, form: FormData): ProbeConfig {
	const str = (k: string) => String(form.get(k) ?? '').trim();
	switch (type) {
		case 'health_check':
			return { url: str('url'), expected_status: positive(form.get('expected_status'), 200) };
		case 'api_canary':
			return {
				endpoint_base: str('endpoint_base'),
				resource_path: str('resource_path'),
				resource_id_field: str('resource_id_field') || 'id',
			};
		case 'login_flow':
			return {
				login_url: str('login_url'),
				username: str('username'),
				expected_redirect: str('expected_redirect'),
			};
		case 'webhook_delivery':
			return { webhook_url: str('webhook_url') };
		default:
			return {};
	}
}

/** The one field each probe type cannot run without. */
const REQUIRED_TARGET: Readonly<Record<string, { field: keyof ProbeConfig; says: string }>> = {
	health_check: { field: 'url', says: 'A health check needs a URL to fetch.' },
	api_canary: { field: 'endpoint_base', says: 'An API canary needs the endpoint it walks.' },
	login_flow: { field: 'login_url', says: 'A sign-in probe needs the URL it signs in at.' },
	webhook_delivery: { field: 'webhook_url', says: 'A webhook probe needs somewhere to deliver to.' },
};

export const load: PageServerLoad = async (event) => {
	const { plugins } = await event.parent();
	const { limit, offset } = pageWindow(event.url, DEFAULT_LIMIT, MAX_LIMIT);

	// The shell says why the page is unavailable while its plugin does not run.
	if (notRunning(plugins, PLUGIN.syntheticMonitoring)) {
		return {
			probes: [] as Probe[],
			alerts: [] as ProbeAlert[],
			total: null as number | null,
			limit,
			offset,
			hasMore: false,
			gate: { state: 'absent' } as SyntheticGate,
			channelsFor: null as ChannelsFor,
		};
	}

	const client = authedClient(event);
	let probes: Probe[] = [];
	let total: number | null = null;
	let hasMore = false;
	let gate: SyntheticGate = SYNTHETIC_OK;
	try {
		const page = pageOf(await listProbes(client, limit + 1, offset), limit, offset);
		probes = page.rows;
		total = page.total;
		hasMore = page.hasMore;
	} catch (err) {
		gate = syntheticGate(err);
	}

	// Alerts are a band above the list. Losing them must not lose the probes,
	// but an unread alert list is never rendered as "nothing is wrong": the
	// page shows the band only when the read succeeded.
	const alerts =
		gate.state === 'ok'
			? await listOpenAlerts(client)
					.then((p) => p.data ?? [])
					.catch((): ProbeAlert[] => [])
			: [];

	// `?channels=<id>` opens the notice channels drawer on that probe. The
	// channels are a read of their own, so they are asked for only then.
	let channelsFor: ChannelsFor = null;
	const channelsId = event.url.searchParams.get('channels');
	const probe = channelsId ? probes.find((p) => p.id === channelsId) : undefined;
	if (gate.state === 'ok' && probe) {
		try {
			channelsFor = { probe, read: await getProbeChannels(client, probe.id), gate: { state: 'ok' } };
		} catch (err) {
			channelsFor = { probe, read: null, gate: gateOf(err, 'The notice channels could not be read.') };
		}
	}

	return { probes, alerts, total, limit, offset, hasMore, gate, channelsFor };
};

async function save(event: Parameters<Actions[string]>[0], id: string | null) {
	await requireRole(event, ['admin', 'super_admin']);
	const client = authedClient(event);
	const form = await event.request.formData();

	const name = String(form.get('name') ?? '').trim();
	const type = probeType(String(form.get('type') ?? ''));
	if (!name) return fail(400, { error: 'Name the probe so an alert can say which one fired.' });
	if (!type) return fail(400, { error: 'Choose a probe type.' });

	const config = configFor(type, form);
	const required = REQUIRED_TARGET[type];
	if (required && !config[required.field]) {
		return fail(400, { error: required.says });
	}

	const interval = positive(form.get('interval_seconds'), 300);
	if (interval < MIN_INTERVAL_SECONDS) {
		return fail(400, {
			error: `A probe runs against this instance, so the shortest interval is ${MIN_INTERVAL_SECONDS} seconds.`,
		});
	}
	const timeout = positive(form.get('timeout_seconds'), 10);
	if (timeout < MIN_TIMEOUT_SECONDS || timeout >= interval) {
		return fail(400, { error: 'The timeout has to be shorter than the interval.' });
	}

	const body = {
		name,
		type,
		enabled: form.get('enabled') === 'true',
		config,
		interval_seconds: interval,
		timeout_seconds: timeout,
		alert_threshold: positive(form.get('alert_threshold'), 3),
	};

	try {
		if (id) await updateProbe(client, id, body);
		else await createProbe(client, body);
	} catch (err) {
		return actionFailure(err, 'The probe could not be saved.');
	}
	return { saved: name };
}

export const actions: Actions = {
	create: (event) => save(event, null),

	update: async (event) => {
		const form = await event.request.clone().formData();
		const id = String(form.get('id') ?? '');
		if (!id) return fail(400, { error: 'No probe was named.' });
		return save(event, id);
	},

	delete: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		const client = authedClient(event);
		const form = await event.request.formData();
		const id = String(form.get('id') ?? '');
		if (!id) return fail(400, { error: 'No probe was named.' });
		try {
			await deleteProbe(client, id);
		} catch (err) {
			return actionFailure(err, 'The probe could not be removed.');
		}
		return { removed: id };
	},

	run: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		const client = authedClient(event);
		const form = await event.request.formData();
		const id = String(form.get('id') ?? '');
		if (!id) return fail(400, { error: 'No probe was named.' });
		try {
			const result = await runProbeNow(client, id);
			return { ran: id, status: result.status, ms: result.response_time_ms };
		} catch (err) {
			return actionFailure(err, 'The probe could not be run.');
		}
	},

	/** Set where a probe's down and recovery notices go. */
	channels: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		const form = await event.request.formData();
		const id = String(form.get('id') ?? '');
		if (!id) return fail(400, { error: 'No probe was named.', channels: true });
		const next = channelsFrom(form, CHANNEL_PREFIX);
		let saved: ProbeChannels;
		try {
			saved = await putProbeChannels(authedClient(event), id, hasChannels(next) ? next : null);
		} catch (err) {
			const failed = actionFailure(err, 'The notice channels could not be saved.');
			return fail(failed.status, { ...failed.data, channels: true });
		}
		return { channelsSaved: id, signingSecret: saved.webhook_signing_secret ?? '' };
	},

	acknowledge: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		const client = authedClient(event);
		const form = await event.request.formData();
		const id = String(form.get('id') ?? '');
		if (!id) return fail(400, { error: 'No alert was named.' });
		try {
			await acknowledgeAlert(client, id);
		} catch (err) {
			return actionFailure(err, 'The alert could not be acknowledged.');
		}
		return { acknowledged: id };
	},
};
