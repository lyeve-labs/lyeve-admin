import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { createClient } from '@lyeve-labs/client';
import {
	getSummary,
	getEndpoints,
	getMethods,
	getAgents,
	getAnomalies,
	type Summary,
	type BreakdownResponse,
	type AnomalyResponse
} from '@lyeve-labs/client-rest';
import { sessionToken } from '$lib/server/session-cookie';

const emptySummary: Summary = {
	from: '',
	to: '',
	total_requests: 0,
	total_2xx: 0,
	total_4xx: 0,
	total_5xx: 0,
	error_rate: 0,
	avg_latency_p50_ms: 0,
	avg_latency_p95_ms: 0,
	avg_latency_p99_ms: 0,
	max_latency_p99_ms: 0,
	avg_request_size_bytes: 0,
	max_request_size_bytes: 0,
	unique_endpoints: 0,
	unique_tenants: 0,
	unique_methods: 0,
	unique_user_agents: 0
};

const emptyBreakdown: BreakdownResponse = { items: [], total: 0 };
const emptyAnomalies: AnomalyResponse = { anomalies: [], window_hours: 0, z_threshold: 0 };

export const load: PageServerLoad = async ({ fetch, cookies, parent, url }) => {
	const { user } = await parent();
	if (!user.roles.some((r) => ['super_admin', 'admin'].includes(r))) {
		error(403, 'Requires admin or super_admin role');
	}

	const token = sessionToken({ cookies, url }) ?? '';
	const client = createClient(fetch, { Authorization: `Bearer ${token}` });

	/*
	 * The range is stated rather than left to the engine. Left open, the
	 * summary and the breakdowns read every retained hour while the page
	 * implies a day, and the number an operator compares against the
	 * dashboard covers a different period from the one the dashboard shows.
	 */
	const from = new Date(Date.now() - 24 * 3_600_000).toISOString();

	const [summary, endpoints, methods, agents, anomalies] = await Promise.all([
		getSummary({ from }, client).catch(() => emptySummary),
		getEndpoints({ from, limit: 20 }, client).catch(() => emptyBreakdown),
		getMethods({ from }, client).catch(() => emptyBreakdown),
		getAgents({ from, limit: 10 }, client).catch(() => emptyBreakdown),
		getAnomalies(undefined, client).catch(() => emptyAnomalies)
	]);

	return { summary, endpoints, methods, agents, anomalies };
};
