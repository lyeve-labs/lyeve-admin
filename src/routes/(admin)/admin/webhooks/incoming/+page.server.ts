import type { PageServerLoad, Actions } from './$types';
import { fail } from '@sveltejs/kit';
import { createClient } from '@lyeve-labs/client';
import {
	getSchemas,
	listIncomingWebhooks,
	createIncomingWebhook,
	updateIncomingWebhook,
	deleteIncomingWebhook
} from '@lyeve-labs/client-rest';
import { authedClient, requireRole } from '$lib/server/authz';
import { actionFailure } from '$lib/server/action-error';
import { sessionToken } from '$lib/server/session-cookie';
import { section } from '$lib/api/gate';

/** What the page says for a list read that failed for no reason it can name. */
const LIST_FAILED = 'The incoming webhooks could not be read. This is not a report that there are none.';

function parseIPList(raw: FormDataEntryValue | null): string[] {
	const s = String(raw ?? '').trim();
	if (!s) return [];
	return s
		.split('\n')
		.map((ip) => ip.trim())
		.filter((ip) => ip.length > 0);
}

export const load: PageServerLoad = async ({ fetch, cookies, url }) => {
	const token = sessionToken({ cookies, url }) ?? '';
	const client = createClient(fetch, { Authorization: `Bearer ${token}` });

	const [incomingWebhooks, schemas] = await Promise.all([
		section(listIncomingWebhooks(client), LIST_FAILED),
		section(getSchemas(client), 'The schemas could not be read.')
	]);

	return { incomingWebhooks, schemas };
};

export const actions: Actions = {
	create: async (event) => {
		// The plugin serves this write to a super admin only.
		await requireRole(event, ['super_admin']);
		const { request } = event;
		const client = authedClient(event);
		const data = await request.formData();

		const rawMap = String(data.get('field_map') ?? '{}');
		let fieldMap: Record<string, string> = {};
		try {
			fieldMap = JSON.parse(rawMap);
		} catch {
			return fail(400, { error: 'Field map must be valid JSON.' });
		}
		// The engine refuses an empty map: every external key has to be mapped to a
		// schema field explicitly. Catch it here so the operator is told before the
		// round trip, and so the default value in the form is never silently wrong.
		if (Object.keys(fieldMap).length === 0) {
			return fail(400, {
				error: 'Field map must connect at least one external key to a schema field.',
			});
		}

		try {
			await createIncomingWebhook(
				{
					name: String(data.get('name') ?? ''),
					schema_name: String(data.get('schema_name') ?? ''),
					secret: String(data.get('secret') ?? ''),
					field_map: fieldMap,
					enabled: data.get('enabled') === 'true' || data.get('enabled') === 'on',
					allowed_ips: parseIPList(data.get('allowed_ips'))
				},
				client
			);
		} catch (err) {
			return actionFailure(err, 'Failed to create incoming webhook');
		}
	},

	update: async (event) => {
		// The plugin serves this write to a super admin only.
		await requireRole(event, ['super_admin']);
		const { request } = event;
		const client = authedClient(event);
		const data = await request.formData();

		const id = String(data.get('id') ?? '');
		const rawMap = String(data.get('field_map') ?? '{}');
		let fieldMap: Record<string, string> = {};
		try {
			fieldMap = JSON.parse(rawMap);
		} catch {
			return fail(400, { error: 'Field map must be valid JSON.' });
		}
		// The engine refuses an empty map: every external key has to be mapped to a
		// schema field explicitly. Catch it here so the operator is told before the
		// round trip, and so the default value in the form is never silently wrong.
		if (Object.keys(fieldMap).length === 0) {
			return fail(400, {
				error: 'Field map must connect at least one external key to a schema field.',
			});
		}

		try {
			await updateIncomingWebhook(
				id,
				{
					name: String(data.get('name') ?? ''),
					schema_name: String(data.get('schema_name') ?? ''),
					secret: String(data.get('secret') ?? ''),
					field_map: fieldMap,
					enabled: data.get('enabled') === 'true' || data.get('enabled') === 'on',
					allowed_ips: parseIPList(data.get('allowed_ips'))
				},
				client
			);
		} catch (err) {
			return actionFailure(err, 'Failed to update incoming webhook');
		}
	},

	delete: async (event) => {
		// The plugin serves this write to a super admin only.
		await requireRole(event, ['super_admin']);
		const { request } = event;
		const client = authedClient(event);
		const data = await request.formData();
		const id = String(data.get('id') ?? '');

		try {
			await deleteIncomingWebhook(id, client);
		} catch (err) {
			return actionFailure(err, 'Failed to delete incoming webhook');
		}
	}
};
