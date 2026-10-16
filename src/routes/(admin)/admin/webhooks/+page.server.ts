import type { PageServerLoad, Actions } from './$types';
import { fail, redirect, type ActionFailure } from '@sveltejs/kit';
import { authedClient, requireRole, requireUser } from '$lib/server/authz';
import type { DeadLetter, Webhook } from '@lyeve-labs/client';
import { getSchemas } from '@lyeve-labs/client-rest';
import { deleteWebhook, testWebhook, listDeliveries, rotateSecret, retryDelivery, replayDeadLetter, dismissDeadLetter, deleteDeadLetter } from '@lyeve-labs/client-rest';
import { actionFailure } from '$lib/server/action-error';
import { createWebhookRecord, updateWebhookRecord, webhookBodyFrom } from '$lib/api/webhook-options';
import { section, type Section } from '$lib/api/gate';
import { pageOf, pageWindow, pastEndOffset, rowsOf, statedTotal, withOffset, type ListEnvelope } from '$lib/api/list';

/** The page size when a request names none. */
const DEFAULT_LIMIT = 50;

/**
 * One below the engine's list ceiling, because the request below asks for a row
 * past the page to learn whether another page exists. At the ceiling that extra
 * row would be clamped away and the last page would always look like the last
 * page.
 */
const MAX_LIMIT = 199;

/** What the page says for a list read that failed for no reason it can name. */
const LIST_FAILED = 'The webhooks could not be read. This is not a report that there are none.';

/** What the drawer says when the schema names could not be read. */
const SCHEMAS_FAILED = 'The schemas could not be read.';

/** One page of the dead letter queue. */
const DEAD_LETTER_PAGE = 50;

/** How many attempts the delivery history asks for. The plugin offers no offset. */
const DELIVERY_LIMIT = 50;

export const load: PageServerLoad = async (event) => {
	const { url } = event;
	const client = authedClient(event);
	const { limit, offset } = pageWindow(url, DEFAULT_LIMIT, MAX_LIMIT);

	/*
	 * Read straight from the client rather than through listWebhooks, which
	 * unwraps the rows and drops the envelope the row count sits in. The page
	 * states a total only when the endpoint sends one and falls back to a probe
	 * row otherwise, so neither branch reports a number nobody measured.
	 */
	const [read, schemas] = await Promise.all([
		section(
			client.get<ListEnvelope<Webhook> | Webhook[]>(
				`/api/admin/webhooks?limit=${limit + 1}&offset=${offset}`
			),
			LIST_FAILED
		),
		section(getSchemas(client), SCHEMAS_FAILED)
	]);

	// The page draws the gate in place of the list, so nothing is paged.
	if (!read.ok) return { webhooks: read, schemas, limit, offset, total: null, hasMore: false };

	const page = pageOf<Webhook>(read.value, limit, offset);
	const back = pastEndOffset(page.rows.length, limit, offset, page.total);
	if (back !== null) redirect(307, withOffset(url, back));
	// Typed, because a bare literal widens `ok` to boolean and the page could
	// no longer tell the two cases apart.
	const webhooks: Section<Webhook[]> = { ok: true, value: page.rows };
	return {
		webhooks,
		schemas,
		limit,
		offset,
		total: page.total,
		hasMore: page.hasMore
	};
};

/**
 * A failure that names the action it came from. The page holds one result for
 * every form, so the drawer shows only its own writes' failures and the page
 * shows the rest.
 */
function tagged(action: string, failure: ActionFailure<Record<string, unknown>>, id?: string) {
	return fail(failure.status, { ...failure.data, action, ...(id ? { id } : {}) });
}

export const actions: Actions = {
	create: async (event) => {
		// The plugin serves this write to a super admin only.
		await requireRole(event, ['super_admin']);
		const parsed = webhookBodyFrom(await event.request.formData());
		if ('error' in parsed) {
			return fail(400, { action: 'create', error: 'Check the highlighted fields.', fields: { [parsed.field ?? 'name']: parsed.error } });
		}
		try {
			await createWebhookRecord(authedClient(event), parsed.body);
		} catch (err) {
			return tagged('create', actionFailure(err, 'Failed to create webhook'));
		}
	},

	update: async (event) => {
		// The plugin serves this write to a super admin only.
		await requireRole(event, ['super_admin']);
		const data = await event.request.formData();
		const id = String(data.get('id') ?? '');
		const parsed = webhookBodyFrom(data);
		if ('error' in parsed) {
			return fail(400, { action: 'update', error: 'Check the highlighted fields.', fields: { [parsed.field ?? 'name']: parsed.error } });
		}
		try {
			await updateWebhookRecord(authedClient(event), id, parsed.body);
		} catch (err) {
			return tagged('update', actionFailure(err, 'Failed to update webhook'));
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
			await deleteWebhook(id, client);
		} catch (err) {
			return tagged('delete', actionFailure(err, 'Failed to delete webhook'));
		}
	},

	test: async (event) => {
		await requireUser(event);
		const { request, fetch, cookies } = event;
		const client = authedClient(event);
		const data = await request.formData();
		const id = String(data.get('id') ?? '');

		try {
			const result = await testWebhook(id, client);
			return { testResult: { id, ...result } };
		} catch (err) {
			return tagged('test', actionFailure(err, 'Failed to test webhook'));
		}
	},

		deliveries: async (event) => {
			await requireUser(event);
			const { request } = event;
			const client = authedClient(event);
			const data = await request.formData();
			const id = String(data.get('id') ?? '');

			try {
				const items = await listDeliveries(id, client, DELIVERY_LIMIT);
				return { deliveries: { id, items, limit: DELIVERY_LIMIT } };
			} catch (err) {
				return tagged('deliveries', actionFailure(err, 'Failed to load deliveries'));
			}
		},

		'rotate-secret': async (event) => {
			// The plugin serves this write to a super admin only.
			await requireRole(event, ['super_admin']);
			const { request } = event;
			const client = authedClient(event);
			const data = await request.formData();
			const id = String(data.get('id') ?? '');
			const newSecret = data.get('new_secret');

			try {
				// The plugin answers the webhook and the new secret beside it, and
				// shows the secret this once, so both are handed to the page.
				const result = (await rotateSecret(id, client, newSecret ? String(newSecret) : undefined)) as unknown as {
					webhook?: { name?: string };
					new_secret?: string;
				};
				return { rotated: { id, name: result.webhook?.name ?? '', secret: result.new_secret ?? '' } };
			} catch (err) {
				return tagged('rotate-secret', actionFailure(err, 'Failed to rotate webhook secret'));
			}
		},

		'retry-delivery': async (event) => {
			await requireUser(event);
			const { request, fetch, cookies } = event;
			const client = authedClient(event);
			const data = await request.formData();
			const id = String(data.get('id') ?? '');
			const deliveryId = String(data.get('delivery_id') ?? '');

			try {
				const result = await retryDelivery(id, deliveryId, client);
				return { retryResult: result };
			} catch (err) {
				return tagged('retry-delivery', actionFailure(err, 'Failed to retry delivery'));
			}
		},

		/*
		 * Read straight from the endpoint rather than through listDeadLetters().
		 * The engine answers with its standard envelope, data and total_count.
		 * The helper's declared type names items and total, so a page reading
		 * through it sees an empty queue while deliveries wait in it.
		 */
		'dead-letters': async (event) => {
			await requireUser(event);
			const { request } = event;
			const client = authedClient(event);
			const data = await request.formData();
			const status = data.get('status');
			// The open queue's pager says it turned a page, which page 1 alone
			// cannot tell apart from the first read.
			const turned = data.get('turn') === 'page';
			const asked = Number(data.get('offset') ?? 0);
			const offset = Number.isInteger(asked) && asked > 0 ? asked : 0;
			const qs = new URLSearchParams({ limit: String(DEAD_LETTER_PAGE), offset: String(offset) });
			if (status) qs.set('status', String(status));

			try {
				const res = await client.get<ListEnvelope<DeadLetter> | DeadLetter[]>(
					`/api/admin/webhook-dead-letters?${qs}`
				);
				return {
					deadLetters: rowsOf(res),
					deadLetterTotal: statedTotal(res),
					deadLetterOffset: offset,
					deadLetterLimit: DEAD_LETTER_PAGE
				};
			} catch (err) {
				// A page turned inside the open queue reports there, and the first
				// read reports above the list, where the button was.
				return tagged(turned ? 'dead-letters-page' : 'dead-letters', actionFailure(err, 'Failed to load dead letters'));
			}
		},

		'dead-letter-replay': async (event) => {
			await requireUser(event);
			const { request, fetch, cookies } = event;
			const client = authedClient(event);
			const data = await request.formData();
			const id = String(data.get('id') ?? '');

			try {
				const result = await replayDeadLetter(id, client);
				return { deadLetterReplay: result };
			} catch (err) {
				return tagged('dead-letter-replay', actionFailure(err, 'Failed to replay dead letter'), id);
			}
		},

		'dead-letter-dismiss': async (event) => {
			await requireUser(event);
			const { request, fetch, cookies } = event;
			const client = authedClient(event);
			const data = await request.formData();
			const id = String(data.get('id') ?? '');

			try {
				const result = await dismissDeadLetter(id, client);
				return { deadLetterDismiss: result };
			} catch (err) {
				return tagged('dead-letter-dismiss', actionFailure(err, 'Failed to dismiss dead letter'), id);
			}
		},

		'dead-letter-delete': async (event) => {
			await requireUser(event);
			const { request, fetch, cookies } = event;
			const client = authedClient(event);
			const data = await request.formData();
			const id = String(data.get('id') ?? '');

			try {
				await deleteDeadLetter(id, client);
			} catch (err) {
				return tagged('dead-letter-delete', actionFailure(err, 'Failed to delete dead letter'), id);
			}
		}
};
