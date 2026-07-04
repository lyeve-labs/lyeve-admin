import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { authedClient } from '$lib/server/authz';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning } from '$lib/plugins';
import {
	ANALYZABLE,
	QUERY_OK,
	analyzeQueries,
	listQueryLog,
	queryGate,
	type Dialect,
	type QueryGate,
	type QueryLogEntry,
} from '$lib/api/query-monitor';
import { pageWindow } from '$lib/api/list';

/** The page size when a request names none. */
const DEFAULT_LIMIT = 50;

/** One below the engine's list ceiling, so a probe row is not clamped away. */
const MAX_LIMIT = 199;

/** How many statements the analyzer is asked to explain at once. */
const ANALYZE_LIMIT = 20;

function dialectOf(value: string | null): Dialect | null {
	return ANALYZABLE.includes(value as Dialect) ? (value as Dialect) : null;
}

export const load: PageServerLoad = async (event) => {
	const { user, plugins } = await event.parent();
	// Captured SQL carries the text of a query written against one tenant's
	// data, so the whole page is the super admin's.
	if (!user.roles.includes('super_admin')) error(403, 'Requires super_admin role');

	const { limit, offset } = pageWindow(event.url, DEFAULT_LIMIT, MAX_LIMIT);
	const dialect = dialectOf(event.url.searchParams.get('dialect'));

	// The shell says why the page is unavailable while its plugin does not run.
	if (notRunning(plugins, PLUGIN.queryMonitor)) {
		return {
			entries: [] as QueryLogEntry[],
			total: 0,
			limit,
			offset,
			gate: { state: 'absent' } as QueryGate,
			dialect,
			analyzed: [] as QueryLogEntry[],
			analyzeFailed: false,
		};
	}

	const client = authedClient(event);
	let entries: QueryLogEntry[] = [];
	let total = 0;
	let gate: QueryGate = QUERY_OK;
	try {
		const page = await listQueryLog(client, limit, offset);
		entries = page.data ?? [];
		// The envelope carries the collection count. Keeping what has been read
		// as the floor answers the case where it omits one.
		total = Math.max(page.total_count ?? 0, offset + entries.length);
	} catch (err) {
		gate = queryGate(err);
	}

	// Analysis runs only when a dialect is asked for. It is EXPLAIN against a
	// live database, which is not something to do on every page view.
	let analyzed: QueryLogEntry[] = [];
	let analyzeFailed = false;
	if (dialect && gate.state === 'ok') {
		try {
			analyzed = await analyzeQueries(client, dialect, ANALYZE_LIMIT);
		} catch {
			// A swallowed failure reads as "nothing to suggest", which is the
			// opposite of what a refusal means on an instance of another dialect.
			analyzeFailed = true;
		}
	}

	return { entries, total, limit, offset, gate, dialect, analyzed, analyzeFailed };
};
