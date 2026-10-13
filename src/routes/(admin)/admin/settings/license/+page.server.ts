import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { authedClient, requireRole } from '$lib/server/authz';
import { ApiError } from '@lyeve-labs/client';
import { getEntitlements } from '@lyeve-labs/client-rest';
import type { LicenseEntitlements } from '$lib/entitlements';
import { sessionToken } from '$lib/server/session-cookie';
import { actionError } from '$lib/server/action-error';
import { forbiddenText } from '$lib/api/gate';

const RENEW_FAILED = 'The license could not be applied. The current license is unchanged.';

/** Roles the engine gives the entitlements to. Nobody else has a license to read. */
const READER_ROLES = ['admin', 'super_admin'];

export const load: PageServerLoad = async (event) => {
	const { user } = await event.parent();
	if (!user.roles.some((role) => READER_ROLES.includes(role))) {
		error(403, forbiddenText('the license'));
	}

	// Read here rather than taken from the shell, which kept its answer across
	// every navigation since the document loaded.
	const entitlements: LicenseEntitlements | null = await getEntitlements(authedClient(event)).catch(() => null);

	// A build that links no license module has no license to show, so the page
	// is not there. An engine that does not say keeps the page.
	if (entitlements?.license_module === false) error(404, 'No page has that address.');

	return { entitlements };
};

/** What the engine answers a renewal with. The token itself never comes back. */
interface RenewResult {
	plan: string;
	state: string;
	features: string[];
	license_source?: string;
	expires_at?: string;
}

export const actions: Actions = {
	// Posts the pasted token or key to the engine, which decides whether it
	// applies. It relicenses the whole install, so only a super admin may
	// submit it, and the engine refuses anyone else as well.
	renew: async (event) => {
		const { request } = event;
		if (!sessionToken(event)) return fail(401, { error: 'Not authenticated' });
		await requireRole(event, ['super_admin']);

		const data = await request.formData();
		const licenseKey = data.get('license_key')?.toString()?.trim();
		if (!licenseKey) return fail(400, { error: 'License key is required' });

		const client = authedClient(event);
		try {
			const result = await client.post<RenewResult>('/api/admin/license/renew', {
				license_key: licenseKey,
			});
			return { success: true, ...result };
		} catch (e) {
			// The license module words its refusal for the operator, so a
			// refusal is shown as it was sent. A failure of the engine is not
			// written for the operator, and its text never reaches the page.
			const status = e instanceof ApiError ? (e.status < 500 ? e.status : 502) : 500;
			return fail(status, { error: actionError(e, RENEW_FAILED) });
		}
	},
};
