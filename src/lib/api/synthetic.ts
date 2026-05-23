/**
 * The synthetic-monitoring plugin's admin routes.
 *
 * A probe is a check the instance runs against itself on a schedule: fetch a
 * URL, walk an API resource through create, read, update and delete, sign in,
 * or deliver a webhook and wait for the receipt. Each run is a result, and a
 * run of consecutive failures past the probe's threshold raises an alert.
 *
 * Three things could each be called "the state of a probe" and they are not
 * the same: whether it is switched on, how its last run went, and whether it
 * has an alert outstanding. A screen that merged them would show a disabled
 * probe as healthy, which is the reading that lets an outage go unnoticed.
 */
import { toChannels, type AlertChannels } from './alert-channels';
import type { HttpClient } from '@lyeve-labs/client';
import { GATE_OK, gateOf, type Gate } from './gate';
import type { ListEnvelope } from './list';

export const PROBES_URL = '/api/admin/synthetic-monitoring/probes';
export const ALERTS_URL = '/api/admin/synthetic-monitoring/alerts';

export const PROBE_TYPES = [
	'health_check',
	'api_canary',
	'login_flow',
	'webhook_delivery',
] as const;
export type ProbeType = (typeof PROBE_TYPES)[number];

export type ProbeStatus = 'pass' | 'fail';

/** What each probe type actually does, for the reader choosing one. */
export const PROBE_TYPE_LABELS: Readonly<Record<ProbeType, string>> = {
	health_check: 'Health check',
	api_canary: 'API canary',
	login_flow: 'Sign-in flow',
	webhook_delivery: 'Webhook delivery',
};

export const PROBE_TYPE_HINTS: Readonly<Record<ProbeType, string>> = {
	health_check: 'Fetches a URL and checks the status code.',
	api_canary: 'Creates, reads, updates and deletes a resource, then verifies it is gone.',
	login_flow: 'Signs in with stored credentials and checks the session that comes back.',
	webhook_delivery: 'Sends a webhook and waits for the receipt.',
};

export interface ProbeConfig {
	url?: string;
	expected_status?: number;
	endpoint_base?: string;
	resource_path?: string;
	resource_id_field?: string;
	login_url?: string;
	username?: string;
	expected_redirect?: string;
	webhook_url?: string;
	headers?: Record<string, string> | null;
}

export interface Probe {
	id: string;
	tenant_id: string;
	name: string;
	type: ProbeType;
	enabled: boolean;
	config: ProbeConfig;
	interval_seconds: number;
	timeout_seconds: number;
	regions: string[] | null;
	alert_threshold: number;
	last_run_at?: string | null;
	last_status?: ProbeStatus | null;
	created_at: string;
	updated_at: string;
}

export interface ProbeResult {
	id: string;
	probe_id: string;
	status: ProbeStatus;
	status_code?: number | null;
	response_time_ms: number;
	error_message?: string;
	region: string;
	detail?: string;
	created_at: string;
}

export interface ProbeAlert {
	id: string;
	probe_id: string;
	probe_name: string;
	probe_type: ProbeType;
	consecutive_failures: number;
	last_failure_at: string;
	last_failure_error?: string;
	message: string;
	acknowledged: boolean;
	acknowledged_at?: string | null;
	created_at: string;
}

export interface TrendBucket {
	time: string;
	avg_ms: number;
	p50_ms: number;
	p95_ms: number;
	p99_ms: number;
	count: number;
	fail_count: number;
}

export type SyntheticGate = Gate;

export const SYNTHETIC_OK: SyntheticGate = GATE_OK;

/** What a refused probe read means, read the way every plugin's is. */
export function syntheticGate(err: unknown): SyntheticGate {
	return gateOf(err, 'The probes could not be read. This is not a report that everything is passing.');
}

export async function listProbes(
	client: HttpClient,
	limit: number,
	offset: number
): Promise<ListEnvelope<Probe>> {
	return client.get<ListEnvelope<Probe>>(`${PROBES_URL}?limit=${limit}&offset=${offset}`);
}

/** Outstanding alerts. Acknowledged ones are history and are not asked for. */
export async function listOpenAlerts(client: HttpClient, limit = 50): Promise<ListEnvelope<ProbeAlert>> {
	return client.get<ListEnvelope<ProbeAlert>>(
		`${ALERTS_URL}?acknowledged=false&limit=${limit}&offset=0`
	);
}

export async function listResults(
	client: HttpClient,
	probeId: string,
	limit = 20
): Promise<ListEnvelope<ProbeResult>> {
	return client.get<ListEnvelope<ProbeResult>>(
		`${PROBES_URL}/${encodeURIComponent(probeId)}/results?limit=${limit}&offset=0`
	);
}

export interface SaveProbe {
	name: string;
	type: ProbeType;
	enabled: boolean;
	config: ProbeConfig;
	interval_seconds: number;
	timeout_seconds: number;
	alert_threshold: number;
}

export async function createProbe(client: HttpClient, body: SaveProbe): Promise<Probe> {
	return client.post<Probe>(PROBES_URL, body);
}

export async function updateProbe(
	client: HttpClient,
	id: string,
	body: SaveProbe
): Promise<Probe> {
	return client.put<Probe>(`${PROBES_URL}/${encodeURIComponent(id)}`, body);
}

export async function deleteProbe(client: HttpClient, id: string): Promise<void> {
	await client.delete(`${PROBES_URL}/${encodeURIComponent(id)}`);
}

export async function runProbeNow(client: HttpClient, id: string): Promise<ProbeResult> {
	return client.post<ProbeResult>(`${PROBES_URL}/${encodeURIComponent(id)}/run`, {});
}

export async function acknowledgeAlert(client: HttpClient, id: string): Promise<void> {
	await client.post(`${ALERTS_URL}/${encodeURIComponent(id)}/acknowledge`, {});
}

/**
 * Where a probe's down and recovery notices go, and whether the plugin would
 * take a new chat, webhook or PagerDuty channel. The signing secret is
 * answered once, by the write that set a new webhook URL.
 */
export interface ProbeChannels {
	channels: AlertChannels;
	licensed: boolean;
	webhook_signing_secret?: string;
}

function toProbeChannels(raw: unknown): ProbeChannels {
	const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
	const secret = typeof r.webhook_signing_secret === 'string' ? r.webhook_signing_secret : '';
	return { channels: toChannels(r.channels), licensed: r.licensed === true, ...(secret ? { webhook_signing_secret: secret } : {}) };
}

export async function getProbeChannels(client: HttpClient, id: string): Promise<ProbeChannels> {
	return toProbeChannels(await client.get<unknown>(`${PROBES_URL}/${encodeURIComponent(id)}/alert-channels`));
}

/** Sets a probe's channels. Null clears every one of them. */
export async function putProbeChannels(
	client: HttpClient,
	id: string,
	channels: AlertChannels | null
): Promise<ProbeChannels> {
	return toProbeChannels(await client.put<unknown>(`${PROBES_URL}/${encodeURIComponent(id)}/alert-channels`, channels));
}

/** Whether a string is a probe type the engine will store. */
export function probeType(value: string): ProbeType | null {
	return PROBE_TYPES.includes(value as ProbeType) ? (value as ProbeType) : null;
}

export type ProbeHealth = 'passing' | 'failing' | 'paused' | 'unrun';

/**
 * What a probe's row should say about it.
 *
 * Switched off comes first and outranks the last result, because a paused
 * probe's last pass is stale by however long it has been paused and reading
 * it as green is how an outage goes unnoticed. A probe that has never run
 * reports that rather than passing: no result is not a good result.
 */
export function probeHealth(p: Probe): ProbeHealth {
	if (!p.enabled) return 'paused';
	if (!p.last_run_at || !p.last_status) return 'unrun';
	return p.last_status === 'pass' ? 'passing' : 'failing';
}

export function probeTone(h: ProbeHealth): 'success' | 'danger' | 'warn' | 'neutral' {
	if (h === 'passing') return 'success';
	if (h === 'failing') return 'danger';
	if (h === 'unrun') return 'warn';
	return 'neutral';
}

export const PROBE_HEALTH_LABELS: Readonly<Record<ProbeHealth, string>> = {
	passing: 'Passing',
	failing: 'Failing',
	paused: 'Paused',
	unrun: 'Never run',
};

/**
 * An interval a person can read.
 *
 * Kept exact rather than rounded: a probe set to 90 seconds must not read as
 * "every 2 minutes", because the number on screen is the one somebody will
 * compare against an alerting threshold elsewhere.
 */
export function everyLabel(seconds: number): string {
	if (!Number.isFinite(seconds) || seconds <= 0) return 'Not scheduled';
	if (seconds % 3600 === 0) {
		const hours = seconds / 3600;
		return `Every ${hours} ${hours === 1 ? 'hour' : 'hours'}`;
	}
	if (seconds % 60 === 0) {
		const minutes = seconds / 60;
		return `Every ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
	}
	return `Every ${seconds} seconds`;
}

/** A response time, at the precision it was measured. */
export function millis(ms: number | null | undefined): string {
	if (ms === null || ms === undefined || !Number.isFinite(ms)) return '-';
	if (ms >= 1000) return `${(ms / 1000).toFixed(2)} s`;
	return `${Math.round(ms)} ms`;
}

/**
 * The one line under a probe's name: what it checks.
 *
 * Read off the config rather than the type, because two health checks against
 * different URLs are different probes and a list that named only the type
 * would show them as the same row twice.
 */
export function probeTarget(p: Probe): string {
	const c = p.config ?? {};
	switch (p.type) {
		case 'health_check':
			return c.url ?? 'No URL set';
		case 'api_canary':
			return [c.endpoint_base, c.resource_path].filter(Boolean).join('') || 'No endpoint set';
		case 'login_flow':
			return c.login_url ?? 'No sign-in URL set';
		case 'webhook_delivery':
			return c.webhook_url ?? 'No webhook URL set';
		default:
			return 'Unknown probe type';
	}
}
