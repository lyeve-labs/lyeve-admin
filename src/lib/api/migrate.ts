/**
 * The engine's DDL migration endpoints.
 *
 * Saving a schema writes DDL to sys_ddl_log and leaves it unapplied, so the
 * instance can be in step with its schemas or behind them. Two endpoints
 * answer for that: one counts what is waiting, one applies it.
 *
 * These take the client rather than `fetch` because the authenticated client is
 * where the session bearer token and the double-submit CSRF header are joined
 * (`$lib/server/authz`). A wrapper that rebuilt the client from `fetch` would
 * have to restate that, and a write that restates it slightly differently is
 * refused with 403 "csrf token required" rather than failing visibly.
 */
import type { HttpClient } from '@lyeve-labs/client';

/** What GET /api/admin/migrate answers with. */
interface PendingResponse {
	pending?: number | null;
}

/** What POST /api/admin/migrate/apply answers with. */
interface AppliedResponse {
	applied?: number | null;
}

/**
 * A count off one of those answers, or null when the field was not a number.
 *
 * An absent or unparseable count is not zero. Zero paints the header chip green
 * and states that the database matches the schemas, which is a claim about a
 * server that did not answer the question.
 */
function count(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Migrations written to the DDL log and not yet applied. Throws if the engine refuses. */
export async function pendingMigrations(client: HttpClient): Promise<number | null> {
	const res = await client.get<PendingResponse | null>('/api/admin/migrate');
	return count(res?.pending);
}

/**
 * Applies every pending migration and answers with how many ran.
 *
 * The endpoint takes no body. `JSON.stringify(undefined)` is undefined, so
 * passing it sends none rather than an empty object the engine has to parse.
 */
export async function applyMigrations(client: HttpClient): Promise<number | null> {
	const res = await client.post<AppliedResponse | null>('/api/admin/migrate/apply', undefined);
	return count(res?.applied);
}
