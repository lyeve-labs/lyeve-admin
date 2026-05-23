import type { PageServerLoad } from './$types';
import { ApiError } from '@lyeve-labs/client';
import { authedClient, requireRole } from '$lib/server/authz';
import { getSecurityControls } from '$lib/api/security';

export const load: PageServerLoad = async (event) => {
	// The engine answers super_admin only. Checking first turns a lower role's
	// visit into a 403 page rather than an empty report that reads as "nothing
	// is protecting this instance".
	await requireRole(event, ['super_admin']);

	try {
		return { report: await getSecurityControls(authedClient(event)), unavailable: null };
	} catch (err) {
		// An engine without the endpoint answers 404, and that is a different
		// sentence from an engine that is down.
		const missing = err instanceof ApiError && err.status === 404;
		return { report: null, unavailable: missing ? 'missing' : 'down' } as const;
	}
};
