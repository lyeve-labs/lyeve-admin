/**
 * Which plugins serve the signed-in tenant, as the engine names them.
 *
 * Every signed-in role may read GET /api/admin/plugins/running. It carries
 * names only, never a reason, an error or a URL, because those are an
 * operator's, and an operator reads them from the plugin status instead. On
 * an engine without the list, the same answer is derived from that status
 * report.
 */
import { ApiError, type HttpClient } from '@lyeve-labs/client';
import type { PluginStatusReport } from '@lyeve-labs/client-rest';

export const RUNNING_PLUGINS_URL = '/api/admin/plugins/running';

/** What the running list answers. Neither list is ever null. */
export interface RunningPlugins {
	/** Plugins running or waiting to start on first use, less those withheld from this tenant, sorted. */
	plugins: string[];
	/** Plugins that run but are withheld from this tenant, sorted. */
	withheld: string[];
}

/**
 * What reading the running list gives: the list, `missing` from an engine
 * without the route, or `failed` when it could not be read.
 */
export type RunningRead = RunningPlugins | 'missing' | 'failed';

function names(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/**
 * Reads the running list. It never throws: a failed read is an answer of its
 * own and never an empty install, because an empty install hides every
 * plugin page from the operator who most needs to see why.
 */
export async function readRunningPlugins(client: HttpClient): Promise<RunningRead> {
	try {
		const res = await client.get<Partial<RunningPlugins> | null>(RUNNING_PLUGINS_URL);
		return { plugins: names(res?.plugins), withheld: names(res?.withheld) };
	} catch (err) {
		return err instanceof ApiError && err.status === 404 ? 'missing' : 'failed';
	}
}

/**
 * The phases in which a plugin serves its routes. A lazy plugin has not
 * started yet and starts on the first request that needs it.
 */
export const SERVING_PHASES: readonly string[] = ['running', 'lazy'];

/**
 * The running list read off a plugin status report, less what is withheld
 * from this tenant: what the list would say on an engine that serves it.
 */
export function runningFromStatus(report: PluginStatusReport, withheld: readonly string[]): RunningPlugins {
	const out: RunningPlugins = { plugins: [], withheld: [] };
	for (const row of report.plugins ?? []) {
		if (!row.compiled || !SERVING_PHASES.includes(row.phase)) continue;
		(withheld.includes(row.name) ? out.withheld : out.plugins).push(row.name);
	}
	out.plugins.sort();
	out.withheld.sort();
	return out;
}
