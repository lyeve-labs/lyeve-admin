/**
 * Content history and activity, as the content plugin serves them.
 *
 * History is the stored versions of each entry, kept per content type when
 * the tenant switches it on. Activity is the record of who changed which
 * entry, kept on its own switch. The server's environment can fix either
 * switch, and the plugin then names the fields it fixed and reads each one as
 * the value in effect. A write that carries a fixed field with another value
 * answers 409, so the console never sends them.
 *
 * An engine older than this feature answers 404 on every route here.
 */
import type { HttpClient } from '@lyeve-labs/client';
import type { ListEnvelope } from './list';

export const HISTORY_SETTINGS_URL = '/api/admin/content/history/settings';
export const HISTORY_USAGE_URL = '/api/admin/content/history/usage';
export const HISTORY_PRUNE_URL = '/api/admin/content/history/prune';
export const HISTORY_URL = '/api/admin/content/history';
export const ACTIVITY_URL = '/api/admin/content/activity';
export const ACTIVITY_ALL_URL = '/api/admin/content/activity/all';

/** The capability that reads versions older than the free window. */
export const HISTORY_READ_FEATURE = 'content-pro';
/** The window a reader without that capability sees, in days. */
export const FREE_READ_DAYS = 30;

/** The longest retention a field takes, in days: a century. */
export const MAX_KEEP_DAYS = 36500;
/** The most versions a field keeps per entry. */
export const MAX_KEEP_VERSIONS = 100000;

export const HISTORY_MODES = ['off', 'all', 'selected'] as const;
export type HistoryMode = (typeof HISTORY_MODES)[number];

/** What the environment says about a switch: the tenant decides, or it is fixed. */
export type EnvSwitch = 'console' | 'off' | 'on';

/** One tenant's choices. A zero `keep_*` means no limit. */
export interface HistorySettings {
	history_mode: HistoryMode;
	/** The type names that keep history when the mode is `selected`. */
	schemas: string[];
	keep_days: number;
	keep_versions: number;
	activity_enabled: boolean;
	activity_keep_days: number;
	updated_by?: string;
	updated_at?: string;
}

/** The settings fields a tenant writes, and the names the plugin locks them by. */
export const SETTING_FIELDS = [
	'history_mode',
	'schemas',
	'keep_days',
	'keep_versions',
	'activity_enabled',
	'activity_keep_days',
] as const;
export type SettingField = (typeof SETTING_FIELDS)[number];

/** The settings read: the tenant's choices, what the environment fixes, and its defaults. */
export interface HistorySettingsRead {
	settings: HistorySettings;
	/** The fields the environment fixes. A write carrying one answers 409. */
	locked: SettingField[];
	/** The two switches as the environment sets them. */
	env: { history: EnvSwitch; activity: EnvSwitch };
	/** The retention a tenant that has not chosen runs under. */
	defaults: { keep_days: number; keep_versions: number; activity_keep_days: number };
}

/** What history holds for the tenant. Bytes are what the database stores and what full copies would take. */
export interface HistoryUsage {
	commits: number;
	objects: number;
	stored_bytes: number;
	logical_bytes: number;
	legacy_rows: number;
	legacy_bytes: number;
	/** When the oldest version kept was written, null with none. */
	oldest_at: string | null;
}

/**
 * What one retention run removed. A run too large to finish in the request
 * answers 202 with `done` false and carries on in the background, so the
 * counts are what it removed so far.
 */
export interface PruneResult {
	commits: number;
	legacy_rows: number;
	activity_rows: number;
	done: boolean;
}

/** What deleting one type's history removed, and how many versions a legal hold kept. */
export interface DeleteResult {
	commits: number;
	held: number;
}

/** One row of activity. */
export interface ActivityRow {
	id: string;
	tenant_id?: string;
	schema_name: string;
	entry_id: string;
	action: string;
	source: string;
	/** The names of the fields the change touched. */
	fields: string[] | null;
	actor_id: string;
	/** The version history recorded for the change, when it recorded one. */
	revision_num?: number;
	created_at: string;
}

/** The filters the activity routes take, by their query names. */
export const ACTIVITY_FILTERS = ['schema', 'entry_id', 'actor', 'action', 'source', 'from', 'to'] as const;
export type ActivityFilter = Record<(typeof ACTIVITY_FILTERS)[number], string>;

/** A body that is not an object reads as an empty one, so a missing key is a default rather than a throw. */
function record(value: unknown): Record<string, unknown> {
	return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function whole(value: unknown): number {
	return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function envSwitch(value: unknown): EnvSwitch {
	return value === 'off' || value === 'on' ? value : 'console';
}

/** The settings read in the shape the page renders, with every absent field at its default. */
export function toSettingsRead(body: unknown): HistorySettingsRead {
	const top = record(body);
	const s = record(top.settings);
	const env = record(top.env);
	const defaults = record(top.defaults);
	const mode = HISTORY_MODES.find((m) => m === s.history_mode) ?? 'off';
	return {
		settings: {
			history_mode: mode,
			schemas: Array.isArray(s.schemas) ? s.schemas.filter((n): n is string => typeof n === 'string') : [],
			keep_days: whole(s.keep_days),
			keep_versions: whole(s.keep_versions),
			activity_enabled: s.activity_enabled !== false,
			activity_keep_days: whole(s.activity_keep_days),
			updated_by: typeof s.updated_by === 'string' ? s.updated_by : undefined,
			updated_at: typeof s.updated_at === 'string' ? s.updated_at : undefined,
		},
		locked: Array.isArray(top.locked)
			? SETTING_FIELDS.filter((f) => (top.locked as unknown[]).includes(f))
			: [],
		env: { history: envSwitch(env.history), activity: envSwitch(env.activity) },
		defaults: {
			keep_days: whole(defaults.keep_days),
			keep_versions: whole(defaults.keep_versions),
			activity_keep_days: whole(defaults.activity_keep_days),
		},
	};
}

export async function readHistorySettings(client: HttpClient): Promise<HistorySettingsRead> {
	return toSettingsRead(await client.get<unknown>(HISTORY_SETTINGS_URL));
}

/** Saves the fields given and only those. A field the environment fixes is never among them. */
export async function saveHistorySettings(
	client: HttpClient,
	changes: Partial<HistorySettings>,
): Promise<HistorySettingsRead> {
	return toSettingsRead(await client.put<unknown>(HISTORY_SETTINGS_URL, changes));
}

export async function readHistoryUsage(client: HttpClient): Promise<HistoryUsage> {
	const u = record(await client.get<unknown>(HISTORY_USAGE_URL));
	return {
		commits: whole(u.commits),
		objects: whole(u.objects),
		stored_bytes: whole(u.stored_bytes),
		logical_bytes: whole(u.logical_bytes),
		legacy_rows: whole(u.legacy_rows),
		legacy_bytes: whole(u.legacy_bytes),
		oldest_at: typeof u.oldest_at === 'string' && u.oldest_at ? u.oldest_at : null,
	};
}

export async function pruneHistory(client: HttpClient): Promise<PruneResult> {
	const r = record(await client.post<unknown>(HISTORY_PRUNE_URL, {}));
	return {
		commits: whole(r.commits),
		legacy_rows: whole(r.legacy_rows),
		activity_rows: whole(r.activity_rows),
		done: r.done !== false,
	};
}

export async function deleteTypeHistory(client: HttpClient, schema: string): Promise<DeleteResult> {
	const r = record(await client.delete<unknown>(`${HISTORY_URL}?schema=${encodeURIComponent(schema)}`));
	return { commits: whole(r.commits), held: whole(r.held) };
}

/**
 * One page of activity. `tenant` is set only for a super admin, and moves
 * the read to the cross-tenant route, where an empty value means every
 * tenant.
 */
export function listActivity(
	client: HttpClient,
	filter: ActivityFilter,
	limit: number,
	offset: number,
	tenant?: string,
): Promise<ListEnvelope<ActivityRow> | ActivityRow[]> {
	const params = new URLSearchParams();
	for (const key of ACTIVITY_FILTERS) if (filter[key]) params.set(key, filter[key]);
	if (tenant) params.set('tenant', tenant);
	params.set('limit', String(limit));
	params.set('offset', String(offset));
	const base = tenant === undefined ? ACTIVITY_URL : ACTIVITY_ALL_URL;
	return client.get<ListEnvelope<ActivityRow> | ActivityRow[]>(`${base}?${params}`);
}

/** Whether the license reads versions older than the free window for this tenant. */
export function readsOlderVersions(ent: { features?: string[]; withheld?: string[] } | null | undefined): boolean {
	return (ent?.features ?? []).includes(HISTORY_READ_FEATURE) && !(ent?.withheld ?? []).includes(HISTORY_READ_FEATURE);
}
