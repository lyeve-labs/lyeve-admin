import { fail } from '@sveltejs/kit';
import { createClient } from '@lyeve-labs/client';
import { requestMagicLink } from '$lib/api/magic-link';
import { recoveryRefusal } from '$lib/server/recovery';
import { checkRateLimit } from '$lib/server/rate-limit';
import { organizationFromForm, organizationFromUrl } from '$lib/organization';
import type { Actions, PageServerLoad } from './$types';

// A link that names the organization fills the field in, and the reader can change or clear it.
export const load: PageServerLoad = ({ url }) => ({ carried: organizationFromUrl(url) });

export const actions: Actions = {
	default: async (event) => {
		const limit = checkRateLimit(event.getClientAddress());
		if (!limit.allowed) {
			return fail(429, { error: 'Too many attempts. Please try again later.', email: '', tenant: '' });
		}

		const form = await event.request.formData();
		const email = String(form.get('email') ?? '').trim();
		const typed = String(form.get('tenant') ?? '').trim();
		if (!email) return fail(400, { error: 'Enter the email address you sign in with.', email, tenant: typed });
		const organization = organizationFromForm(form);
		if (!organization.ok) return fail(400, { error: organization.error, email, tenant: typed });

		try {
			await requestMagicLink(createClient(event.fetch), email, organization.value);
		} catch (e) {
			const refused = recoveryRefusal(e, 'Email sign-in');
			if (refused) return fail(refused.status, { error: refused.error, email, tenant: typed });
			return fail(400, { error: 'Enter a valid email address.', email, tenant: typed });
		}
		// The engine answers the same whether or not the address has an
		// account or the organization exists, and so does this page.
		return { sent: true, email };
	},
};
