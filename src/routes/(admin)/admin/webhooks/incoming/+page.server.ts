import type { PageServerLoad, Actions } from './$types';
import { fail, redirect, type ActionFailure } from '@sveltejs/kit';
import type { IncomingWebhook } from '@lyeve-labs/client';
import {
	getSchemas,
	createIncomingWebhook,
	updateIncomingWebhook,
	deleteIncomingWebhook
} from '@lyeve-labs/client-rest';
import { authedClient, requireRole } from '$lib/server/authz';
import { actionFailure } from '$lib/server/action-error';
import { section, type Section } from '$lib/api/gate';
import { pageOf, pageWindow, pastEndOffset, withOffset, type ListEnvelope } from '$lib/api/list';

/** The page size when a request names none. */
const DEFAULT_LIMIT = 50;

/**
 * One below the engine's list ceiling, because the request below asks for a row
 * past the page to learn whether another page exists.
 */
const MAX_LIMIT = 199;

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

export const load: PageServerLoad = async (event) => {
	const { url } = event;
	const client = authedClient(event);
	const { limit, offset } = pageWindow(url, DEFAULT_LIMIT, MAX_LIMIT);

	// Read from the client rather than through the list helper, which drops the
	// envelope that carries the row count and the license flag.
	const [read, schemas] = await Promise.all([
		section(
			client.get<(ListEnvelope<IncomingWebhook> & { licensed?: unknown }) | IncomingWebhook[]>(
				`/api/admin/incoming-webhooks?limit=${limit + 1}&offset=${offset}`
			),
			LIST_FAILED
		),
		section(getSchemas(client), 'The schemas could not be read.')
	]);

	if (!read.ok) {
		return { incomingWebhooks: read, schemas, limit, offset, total: null, hasMore: false, licensed: null };
	}

	const page = pageOf<IncomingWebhook>(read.value, limit, offset);
	const back = pastEndOffset(page.rows.length, limit, offset, page.total);
	if (back !== null) redirect(307, withOffset(url, back));
	// The plugin says whether create and update will open. An older plugin
	// sends nothing, and then the page keeps both live and lets the write answer.
	const flag = Array.isArray(read.value) ? undefined : read.value.licensed;
	const licensed = typeof flag === 'boolean' ? flag : null;
	const incomingWebhooks: Section<IncomingWebhook[]> = { ok: true, value: page.rows };
	return {
		incomingWebhooks,
		schemas,
		limit,
		offset,
		total: page.total,
		hasMore: page.hasMore,
		licensed
	};
};

/**
 * A failure that names the action it came from. The page holds one result for
 * every form, so the drawer shows only its own writes' failures and the page
 * shows the rest.
 */
function tagged(action: string, failure: ActionFailure<Record<string, unknown>>) {
	return fail(failure.status, { ...failure.data, action });
}

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
			return fail(400, { action: 'create', error: 'Field map must be valid JSON.' });
		}
		// The engine refuses an empty map: every external key has to be mapped to a
		// schema field explicitly. Catch it here so the operator is told before the
		// round trip, and so the default value in the form is never silently wrong.
		if (Object.keys(fieldMap).length === 0) {
			return fail(400, {
				action: 'create',
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
			return tagged('create', actionFailure(err, 'Failed to create incoming webhook'));
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
			return fail(400, { action: 'update', error: 'Field map must be valid JSON.' });
		}
		// The engine refuses an empty map: every external key has to be mapped to a
		// schema field explicitly. Catch it here so the operator is told before the
		// round trip, and so the default value in the form is never silently wrong.
		if (Object.keys(fieldMap).length === 0) {
			return fail(400, {
				action: 'update',
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
			return tagged('update', actionFailure(err, 'Failed to update incoming webhook'));
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
			return tagged('delete', actionFailure(err, 'Failed to delete incoming webhook'));
		}
	}
};
