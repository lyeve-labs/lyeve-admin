import type { PageServerLoad } from './$types';
import { createClient } from '@lyeve-labs/client';
import { listPlugins, type PluginBreakdown } from '$lib/api/profiler';
import { detailFor } from '$lib/plugin-rows';
import { sessionToken } from '$lib/server/session-cookie';

/**
 * The plugin as the shell's status report describes it, and the requests
 * the profiler sampled through it.
 *
 * Only an operator reads the status report, so for anyone else the plugin is
 * null and the page names it by its name. The profiler's ring describes every
 * tenant's traffic and answers a super admin only, so traffic is read for a
 * super admin alone. Null means it could not be read: the profiler is not
 * running, or the reader may not see it.
 */
export const load: PageServerLoad = async ({ params, fetch, cookies, parent, url }) => {
	const { user, pluginStatus } = await parent();
	const name = params.name;
	const roles = user?.roles ?? [];

	let traffic: PluginBreakdown | null = null;
	let trafficRead = false;
	if (roles.includes('super_admin')) {
		const token = sessionToken({ cookies, url }) ?? '';
		const client = createClient(fetch, { Authorization: `Bearer ${token}` });
		const sampled = await listPlugins(client).catch(() => null);
		if (sampled) {
			trafficRead = true;
			traffic = sampled.find((p) => p.plugin === name) ?? null;
		}
	}

	return {
		pluginName: name,
		plugin: detailFor(pluginStatus, name),
		traffic,
		trafficRead,
		userRoles: roles,
	};
};
