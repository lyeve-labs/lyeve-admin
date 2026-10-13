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
import { section, type Section } from '$lib/api/gate';
import { actionError } from '$lib/server/action-error';
import { authedClient, requireRole } from '$lib/server/authz';
import { sessionToken } from '$lib/server/session-cookie';

/**
 * What the page renders. Every view is the profiler plugin's, under
 * /api/admin/debug/profiler, super_admin only: the ring describes every
 * tenant's traffic. A view the plugin did not answer keeps the reason on its
 * own, so the page says so in place rather than rendering a measurement of
 * nothing.
 */
export interface ProfilerPage {
	endpoints: Section<EndpointStats[]>;
	slowest: Section<EndpointStats[]>;
	plugins: Section<PluginBreakdown[]>;
	memory: Section<MemoryTrend | null>;
	/**
	 * The endpoint the URL selected, and its detail. Null when none is
	 * selected. The value is null when the ring holds no sample of it.
	 */
	selected: string | null;
	detail: Section<EndpointDetail | null> | null;
}

/** What each view says when its read failed for a reason it cannot name. */
const FAILED = {
	endpoints: 'The endpoint statistics could not be read. This is not a report that nothing was sampled.',
	plugins: 'The per-plugin statistics could not be read. This is not a report that nothing was sampled.',
	memory: 'The memory snapshots could not be read.',
	detail: 'This endpoint could not be read. This is not a report that it has no samples.',
} as const;

/**
 * The plugin answers 404 for a path its ring holds no sample of, which is an
 * answer and not a missing plugin. A missing plugin also refuses every other
 * view on the page, and those say so.
 */
async function sampled(read: Promise<EndpointDetail>): Promise<EndpointDetail | null> {
	try {
		return await read;
	} catch (err) {
		if (err instanceof ApiError && err.status === 404) return null;
		throw err;
	}
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
		section(listEndpoints(client), FAILED.endpoints),
		section(listSlowest(client), FAILED.endpoints),
		section(listPlugins(client), FAILED.plugins),
		section(readMemoryTrend(client), FAILED.memory),
		selected ? section(sampled(readEndpoint(client, selected)), FAILED.detail) : Promise.resolve(null),
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
