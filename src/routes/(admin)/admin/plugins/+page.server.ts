import type { PageServerLoad } from './$types';
import { createClient } from '@lyeve-labs/client';
import { getPluginStatus, type PluginStatus } from '@lyeve-labs/client-rest';
import { sessionToken } from '$lib/server/session-cookie';

/**
 * The plugin status, read on every visit rather than taken from the shell's
 * copy, because this page is where an operator comes to see what the engine
 * reports now. Every row comes from it, so a failed read is said as a failure
 * and the page lists nothing it could not read.
 */
export const load: PageServerLoad = async ({ fetch, cookies, parent, url }) => {
	await parent();
	const token = sessionToken({ cookies, url }) ?? '';
	const client = createClient(fetch, { Authorization: `Bearer ${token}` });

	return getPluginStatus(client).then(
		(report) => ({ plugins: report.plugins ?? [], error: null as string | null }),
		(err: unknown) => ({
			plugins: [] as PluginStatus[],
			error: err instanceof Error ? err.message : 'Failed to load plugin status',
		}),
	);
};
