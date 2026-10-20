import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import {
	getSummary,
	getEndpoints,
	getMethods,
	getAgents,
	getAnomalies
} from '@lyeve-labs/client-rest';
import { section } from '$lib/api/gate';
import { authedClient, loadUser } from '$lib/server/authz';

/** What each part of the page says when its read failed for a reason it cannot name. */
const FAILED = {
	summary: 'The request summary could not be read. This is not a report that there was no traffic.',
	endpoints: 'The endpoint breakdown could not be read. This is not a report that no endpoint was called.',
	methods: 'The method breakdown could not be read. This is not a report that there were no requests.',
	agents: 'The user agent breakdown could not be read. This is not a report that no client called.',
	anomalies: 'The anomalies could not be read. This is not a report that there are none.',
} as const;

export const load: PageServerLoad = async (event) => {
	const user = await loadUser(event);
	if (!user.roles.some((r) => ['super_admin', 'admin'].includes(r))) {
		error(403, 'Requires admin or super_admin role');
	}

	const client = authedClient(event);

	/*
	 * The range is stated rather than left to the engine. Left open, the
	 * summary and the breakdowns read every retained hour while the page
	 * implies a day, and the number an operator compares against the
	 * dashboard covers a different period from the one the dashboard shows.
	 */
	const from = new Date(Date.now() - 24 * 3_600_000).toISOString();

	const [summary, endpoints, methods, agents, anomalies] = await Promise.all([
		section(getSummary({ from }, client), FAILED.summary),
		section(getEndpoints({ from, limit: 20 }, client), FAILED.endpoints),
		section(getMethods({ from }, client), FAILED.methods),
		section(getAgents({ from, limit: 10 }, client), FAILED.agents),
		section(getAnomalies(undefined, client), FAILED.anomalies)
	]);

	return { summary, endpoints, methods, agents, anomalies };
};
