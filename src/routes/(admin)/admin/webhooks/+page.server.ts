import type { PageServerLoad, Actions } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { createClient } from '@lyeve-labs/client';
import { authedClient, requireUser } from '$lib/server/authz';
import type { DeadLetter, Webhook } from '@lyeve-labs/client';
import { getSchemas } from '@lyeve-labs/client-rest';
import { deleteWebhook, testWebhook, listDeliveries, rotateSecret, retryDelivery, replayDeadLetter, dismissDeadLetter, deleteDeadLetter } from '@lyeve-labs/client-rest';
import { actionFailure } from '$lib/server/action-error';
import { createWebhookRecord, updateWebhookRecord, webhookBodyFrom } from '$lib/api/webhook-options';
import { pageOf, pageWindow, pastEndOffset, rowsOf, statedTotal, withOffset, type ListEnvelope } from '$lib/api/list';
import { sessionToken } from '$lib/server/session-cookie';

/** The page size when a request names none. */
const DEFAULT_LIMIT = 50;

/**
 * One below the engine's list ceiling, because the request below asks for a row
 * past the page to learn whether another page exists. At the ceiling that extra
 * row would be clamped away and the last page would always look like the last
 * page.
 */
const MAX_LIMIT = 199;

export const load: PageServerLoad = async ({ fetch, cookies, url }) => {
	const token = sessionToken({ cookies, url }) ?? '';
	const client = createClient(fetch, { Authorization: `Bearer ${token}` });
	const { limit, offset } = pageWindow(url, DEFAULT_LIMIT, MAX_LIMIT);

	/*
	 * Read straight from the client rather than through listWebhooks, which
	 * unwraps the rows and drops the envelope the row count sits in. The page
	 * states a total only when the endpoint sends one and falls back to a probe
	 * row otherwise, so neither branch reports a number nobody measured.
	 */
	const [res, schemas] = await Promise.all([
		client
			.get<ListEnvelope<Webhook> | Webhook[]>(
				`/api/admin/webhooks?limit=${limit + 1}&offset=${offset}`
			)
			.catch(() => null),
		getSchemas(client).catch(() => [])
	]);

	const page = pageOf<Webhook>(res, limit, offset);
	const back = pastEndOffset(page.rows.length, limit, offset, page.total);
	if (back !== null) redirect(307, withOffset(url, back));
	return {
		webhooks: page.rows,
		schemas,
		limit,
		offset,
		total: page.total,
		hasMore: page.hasMore
	};
};

export const actions: Actions = {
	create: async (event) => {
		await requireUser(event);
		const parsed = webhookBodyFrom(await event.request.formData());
		if ('error' in parsed) {
			return fail(400, { error: 'Check the highlighted fields.', fields: { [parsed.field ?? 'name']: parsed.error } });
		}
		try {
			await createWebhookRecord(authedClient(event), parsed.body);
		} catch (err) {
			return actionFailure(err, 'Failed to create webhook');
		}
	},

	update: async (event) => {
		await requireUser(event);
		const data = await event.request.formData();
		const id = String(data.get('id') ?? '');
		const parsed = webhookBodyFrom(data);
		if ('error' in parsed) {
			return fail(400, { error: 'Check the highlighted fields.', fields: { [parsed.field ?? 'name']: parsed.error } });
		}
		try {
			await updateWebhookRecord(authedClient(event), id, parsed.body);
		} catch (err) {
			return actionFailure(err, 'Failed to update webhook');
		}
	},

	delete: async (event) => {
		await requireUser(event);
		const { request } = event;
		const client = authedClient(event);
		const data = await request.formData();
		const id = String(data.get('id') ?? '');

		try {
			await deleteWebhook(id, client);
		} catch (err) {
			return actionFailure(err, 'Failed to delete webhook');
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
			return actionFailure(err, 'Failed to test webhook');
		}
	},

		deliveries: async (event) => {
			await requireUser(event);
			const { request } = event;
			const client = authedClient(event);
			const data = await request.formData();
			const id = String(data.get('id') ?? '');

			try {
				const items = await listDeliveries(id, client, 50);
				return { deliveries: { id, items } };
			} catch (err) {
				return actionFailure(err, 'Failed to load deliveries');
			}
		},

		'rotate-secret': async (event) => {
			await requireUser(event);
			const { request } = event;
			const client = authedClient(event);
			const data = await request.formData();
			const id = String(data.get('id') ?? '');
			const newSecret = data.get('new_secret');

			try {
				const result = await rotateSecret(id, client, newSecret ? String(newSecret) : undefined);
				return { rotateSecretResult: result };
			} catch (err) {
				return actionFailure(err, 'Failed to rotate webhook secret');
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
				return actionFailure(err, 'Failed to retry delivery');
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
			const qs = new URLSearchParams({ limit: '50', offset: '0' });
			if (status) qs.set('status', String(status));

			try {
				const res = await client.get<ListEnvelope<DeadLetter> | DeadLetter[]>(
					`/api/admin/webhook-dead-letters?${qs}`
				);
				return { deadLetters: rowsOf(res), deadLetterTotal: statedTotal(res) };
			} catch (err) {
				return actionFailure(err, 'Failed to load dead letters');
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
				return actionFailure(err, 'Failed to replay dead letter');
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
				return actionFailure(err, 'Failed to dismiss dead letter');
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
				return actionFailure(err, 'Failed to delete dead letter');
			}
		}
};
