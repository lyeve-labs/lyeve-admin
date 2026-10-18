import type { PageServerLoad } from './$types';
import { assertRole, authedClient, loadUser } from '$lib/server/authz';
import { getSecurityControls } from '$lib/api/security';
import { section } from '$lib/api/gate';

export const load: PageServerLoad = async (event) => {
	// The engine answers super_admin only. Checking first turns a lower role's
	// visit into a 403 page rather than an empty report that reads as "nothing
	// is protecting this instance".
	assertRole(await loadUser(event), ['super_admin']);

	const report = await section(
		getSecurityControls(authedClient(event)),
		'The security report could not be read. This is not a report that nothing protects this instance.'
	);
	return { report };
};
