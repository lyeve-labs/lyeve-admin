import type { Actions, PageServerLoad } from './$types';
import { ApiError, createClient } from '@lyeve-labs/client';
import { error, fail } from '@sveltejs/kit';
import {
	captureFlamegraph,
	clampSeconds,
	listEndpoints,
	listPlugins,
	listSlowest,
	readEndpoint,
	readMemoryTrend,
	resetProfiler,
	type EndpointDetail,
	type EndpointStats,
	type MemoryTrend,
	type PluginBreakdown,
} from '$lib/api/profiler';
import { actionError } from '$lib/server/action-error';
import { authedClient, requireRole } from '$lib/server/authz';
import { sessionToken } from '$lib/server/session-cookie';

/**
 * What the page renders. Every view is the profiler plugin's, under
 * /api/admin/debug/profiler, super_admin only: the ring describes every
 * tenant's traffic. A view the plugin did not answer is null on its own so
 * the page says so in place rather than rendering a measurement of nothing.
 */
export interface ProfilerPage {
	endpoints: EndpointStats[] | null;
	slowest: EndpointStats[] | null;
	plugins: PluginBreakdown[] | null;
	memory: MemoryTrend | null;
	/** The endpoint the URL selected, and its detail when the ring holds it. */
	selected: string | null;
	detail: EndpointDetail | null;
}

export const load: PageServerLoad = async ({ fetch, cookies, url, parent }) => {
	const { user } = await parent();
	if (!user.roles.includes('super_admin')) {
		error(403, 'Requires super_admin role');
	}
	const token = sessionToken({ cookies, url }) ?? '';
	const client = createClient(fetch, { Authorization: `Bearer ${token}` });

	// The selection is a query parameter, so a detail is a link and survives
	// a refresh. The engine samples paths with their leading slash.
	const asked = url.searchParams.get('endpoint')?.trim() ?? '';
	const selected = asked ? '/' + asked.replace(/^\/+/, '') : null;

	const [endpoints, slowest, plugins, memory, detail] = await Promise.all([
		listEndpoints(client).catch(() => null),
		listSlowest(client).catch(() => null),
		listPlugins(client).catch(() => null),
		readMemoryTrend(client).catch(() => null),
		selected ? readEndpoint(client, selected).catch(() => null) : Promise.resolve(null),
	]);

	const page: ProfilerPage = { endpoints, slowest, plugins, memory, selected, detail };
	return page;
};

export const actions: Actions = {
	reset: async (event) => {
		await requireRole(event, ['super_admin']);
		try {
			await resetProfiler(authedClient(event));
			return { form: 'reset' as const, reset: true };
		} catch (err) {
			return fail(400, { form: 'reset' as const, error: actionError(err, 'The profiler could not be reset.') });
		}
	},

	flamegraph: async (event) => {
		await requireRole(event, ['super_admin']);
		const data = await event.request.formData();
		const endpoint = String(data.get('endpoint') ?? '').trim();
		const seconds = clampSeconds(data.get('duration_sec'));
		if (!endpoint) return fail(422, { form: 'flamegraph' as const, error: 'Name the endpoint the graph is labeled with.' });
		try {
			const graph = await captureFlamegraph(authedClient(event), endpoint, seconds);
			return { form: 'flamegraph' as const, graph };
		} catch (err) {
			if (err instanceof ApiError && err.status === 403) {
				return fail(403, { form: 'flamegraph' as const, error: 'Only a super admin can capture a profile.' });
			}
			return fail(400, { form: 'flamegraph' as const, error: actionError(err, 'The flamegraph could not be captured.') });
		}
	},
};
