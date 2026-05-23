import type { PageServerLoad, Actions } from './$types';
import { fail } from '@sveltejs/kit';
import { authedClient, requireRole } from '$lib/server/authz';
import { actionError, actionFailure } from '$lib/server/action-error';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning } from '$lib/plugins';
import { GATE_OK, gateOf, type Gate } from '$lib/api/gate';
import {
	CONFIG_FIELDS,
	DELIVERY_STATUSES,
	MAX_ATTEMPTS,
	MAX_BACKOFF_SECONDS,
	createProvider,
	deleteProvider,
	isProviderType,
	listDeliveries,
	listProviders,
	replayDelivery,
	updateProvider,
	type Delivery,
	type DeliveryStatus,
	type Listed,
	type Provider,
	type ProviderInput,
	type ProviderType,
} from '$lib/api/analytics-destinations';

function statusOf(url: URL): DeliveryStatus | '' {
	const s = url.searchParams.get('status') ?? '';
	return (DELIVERY_STATUSES as readonly string[]).includes(s) ? (s as DeliveryStatus) : '';
}

export const load: PageServerLoad = async (event) => {
	const { plugins } = await event.parent();
	const status = statusOf(event.url);
	let gate: Gate = notRunning(plugins, PLUGIN.productAnalytics) ? { state: 'absent' } : GATE_OK;
	let providers: Listed<Provider> = { data: [], licensed: false };
	// A failed delivery read is said as one, never drawn as an empty queue.
	let deliveries: Listed<Delivery> | null = null;
	if (gate.state === 'ok') {
		const client = authedClient(event);
		try {
			providers = await listProviders(client);
		} catch (err) {
			gate = gateOf(err, 'The destinations could not be read.');
		}
		if (gate.state === 'ok') deliveries = await listDeliveries(client, status).catch(() => null);
	}
	return { gate, providers: providers.data, licensed: providers.licensed, deliveries, status };
};

/** The settings the form named for a type, or null when it named none. */
function configFrom(type: ProviderType, form: FormData): Record<string, string> | null {
	const out: Record<string, string> = {};
	for (const f of CONFIG_FIELDS[type]) {
		const v = String(form.get(`config_${f.key}`) ?? '').trim();
		if (v) out[f.key] = v;
	}
	return Object.keys(out).length ? out : null;
}

/** The retry policy the form posted, or the sentence that refuses it. */
function retryFrom(form: FormData): { attempts: number; backoff: number } | { error: string } {
	const attempts = Number(form.get('max_attempts') ?? 1);
	const backoff = Number(form.get('backoff_seconds') ?? 0);
	if (!Number.isInteger(attempts) || attempts < 1 || attempts > MAX_ATTEMPTS) {
		return { error: `Attempts are 1 to ${MAX_ATTEMPTS}.` };
	}
	if (attempts > 1 && (!Number.isInteger(backoff) || backoff < 1 || backoff > MAX_BACKOFF_SECONDS)) {
		return { error: `The first retry waits 1 to ${MAX_BACKOFF_SECONDS} seconds.` };
	}
	return { attempts, backoff: attempts > 1 ? backoff : 0 };
}

export const actions: Actions = {
	save: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		const form = await event.request.formData();
		const id = String(form.get('id') ?? '').trim();
		const name = String(form.get('name') ?? '').trim();
		const type = String(form.get('type') ?? '');
		if (!name) return fail(400, { error: 'Name the destination.', drawer: true });
		if (!isProviderType(type)) return fail(400, { error: 'Pick a destination type.', drawer: true });
		const retry = retryFrom(form);
		if ('error' in retry) return fail(400, { error: retry.error, drawer: true });
		const config = configFrom(type, form);
		const missing = CONFIG_FIELDS[type].find((f) => f.required && !config?.[f.key]);
		// A new destination needs every required setting. An edit that names
		// none keeps the stored ones, and one that names any replaces all.
		if (missing && (!id || config)) {
			return fail(400, { error: `${missing.label} is required.`, drawer: true });
		}

		const body: ProviderInput = { name, enabled: form.get('enabled') === 'true' };
		if (config) body.config = config;
		// A new destination sends a policy only when it retries, so one that
		// does not is never asked about a license. An edit resends the policy
		// as it stands, which the plugin takes without one.
		if (id || retry.attempts > 1) {
			body.retry_policy = { max_attempts: retry.attempts, backoff_seconds: retry.backoff };
		}
		if (id && form.get('rotate_secret') === 'true') body.rotate_secret = true;

		let saved: Provider;
		try {
			saved = id ? await updateProvider(authedClient(event), id, body) : await createProvider(authedClient(event), { ...body, type });
		} catch (err) {
			const failed = actionFailure(err, 'The destination could not be saved.');
			return fail(failed.status, { ...failed.data, drawer: true });
		}
		return { saved: saved.name || name, signingSecret: saved.signing_secret ?? '' };
	},

	delete: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		const id = String((await event.request.formData()).get('id') ?? '');
		if (!id) return fail(400, { error: 'No destination was named.' });
		try {
			await deleteProvider(authedClient(event), id);
		} catch (err) {
			return fail(400, { error: actionError(err, 'The destination could not be deleted.') });
		}
		return { deleted: id };
	},

	replay: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		const id = String((await event.request.formData()).get('id') ?? '');
		if (!id) return fail(400, { error: 'No delivery was named.' });
		try {
			const out = await replayDelivery(authedClient(event), id);
			return { replayed: id, delivered: out.delivered, lastError: out.delivery?.last_error ?? '' };
		} catch (err) {
			return actionFailure(err, 'The delivery could not be sent again.');
		}
	},
};
