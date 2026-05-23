/**
 * The query-monitor plugin's admin routes.
 *
 * Every route is super admin: a captured statement carries its text, and the
 * text of a query written against one tenant's data is that tenant's. The
 * plugin samples after the fact rather than intercepting, so the log is what
 * was slow recently and not a live trace.
 *
 * Analysis is a separate call per dialect because EXPLAIN is a separate
 * grammar per dialect, and an instance runs one. The page asks for the one
 * the engine reports and never guesses.
 */
import { ApiError, type HttpClient } from '@lyeve-labs/client';
import { GATE_OK, gateOf, type Gate } from './gate';

export const QUERY_LOG_URL = '/api/admin/query-log';

/** The dialects the plugin can explain, each with its own analyze route. */
export const ANALYZABLE = ['postgres', 'mysql', 'mssql'] as const;
export type Dialect = (typeof ANALYZABLE)[number];

const ANALYZE_PATH: Record<Dialect, string> = {
	postgres: '/api/admin/query-log/analyze-pg',
	mysql: '/api/admin/query-log/analyze-mysql',
	mssql: '/api/admin/query-log/analyze-mssql',
};

/** One index the analyzer thinks would help, with the DDL to create it. */
export interface IndexSuggestion {
	table: string;
	columns: string[];
	reason: string;
	estimated_benefit?: string;
	ddl?: string;
}

/** What the analyzer read out of the plan. */
export interface QueryAnalysis {
	has_seq_scan?: boolean;
	has_hash_join?: boolean;
	has_nested_loop?: boolean;
	rows_estimated?: number;
	actual_rows?: number;
	planning_time_ms?: number;
	execution_time_ms?: number;
	index_suggestions?: IndexSuggestion[];
}

/** One captured statement as GET /api/admin/query-log lists it. */
export interface QueryLogEntry {
	id: string;
	tenant_id?: string;
	query_hash: string;
	query_text: string;
	plan_text?: string;
	duration_ms: number;
	rows_returned?: number;
	caller_file?: string;
	caller_line?: number;
	engine: string;
	captured_at: string;
	analysis?: QueryAnalysis | null;
}

interface Page<T> {
	data?: T[] | null;
	total_count?: number;
	limit?: number;
	offset?: number;
}

/**
 * Why a read came back empty, when it did.
 *
 * A 402 is the feature not enabled, and the page says so. A 404 is the
 * plugin absent from this build. A 503 is the store, which for a sampler
 * usually means the capture table is not there yet. Anything else keeps the
 * banner, which is not a report that nothing was slow.
 */
export type QueryGate = Gate | { state: 'unavailable' };

export const QUERY_OK: QueryGate = GATE_OK;

/**
 * What a refused query log read means, read the way every plugin's is, and a
 * 503 as the plugin saying it has no database to sample, which is its own
 * state rather than a failure.
 */
export function queryGate(err: unknown): QueryGate {
	if (err instanceof ApiError && err.status === 503) return { state: 'unavailable' };
	return gateOf(err, 'The query log could not be read. This is not a report that nothing was slow.');
}

export async function listQueryLog(
	client: HttpClient,
	limit: number,
	offset: number,
): Promise<Page<QueryLogEntry>> {
	return client.get<Page<QueryLogEntry>>(`${QUERY_LOG_URL}?limit=${limit}&offset=${offset}`);
}

/**
 * The slowest statements the analyzer could explain, newest first.
 *
 * An instance that is not on this dialect answers 400 or 503 rather than an
 * empty list, so the caller keeps the failure rather than drawing "nothing
 * was slow" over a refusal.
 */
export async function analyzeQueries(
	client: HttpClient,
	dialect: Dialect,
	limit: number,
): Promise<QueryLogEntry[]> {
	const res = await client.get<Page<QueryLogEntry> | QueryLogEntry[]>(
		`${ANALYZE_PATH[dialect]}?limit=${limit}`,
	);
	return Array.isArray(res) ? res : (res.data ?? []);
}

/** A duration worth coloring. The engine samples what is already slow. */
export function durationTone(ms: number): 'danger' | 'warn' | 'neutral' {
	if (ms >= 1000) return 'danger';
	if (ms >= 250) return 'warn';
	return 'neutral';
}

/**
 * The statement on one line, for a table cell.
 *
 * Captured SQL arrives with the newlines and runs of spaces the caller wrote,
 * which in a table cell reads as a blank row followed by a wrapped one.
 */
export function oneLine(sql: string, max = 160): string {
	const flat = sql.replace(/\s+/g, ' ').trim();
	// max is the width of the result, ellipsis included, so a caller sizing a
	// column gets the width it asked for rather than three characters more.
	return flat.length > max ? `${flat.slice(0, Math.max(0, max - 3))}...` : flat;
}

/** Where the statement was issued, when the sampler caught a caller. */
export function callerOf(entry: QueryLogEntry): string | null {
	if (!entry.caller_file) return null;
	return entry.caller_line ? `${entry.caller_file}:${entry.caller_line}` : entry.caller_file;
}
