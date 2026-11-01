import type { PageServerLoad, Actions } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { authedClient, requireRole } from '$lib/server/authz';
import { actionError } from '$lib/server/action-error';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning } from '$lib/plugins';
import {
	MIN_TOKEN_LENGTH,
	SCIM_OK,
	createProvider,
	deleteProvider,
	deprovisionAction,
	listProviders,
	rotateToken,
	scimGate,
	type ScimGate,
	type ScimProvider,
} from '$lib/api/scim';
import { pageOf, pageWindow, pastEndOffset, withOffset } from '$lib/api/list';
import { listProviders as listSamlProviders, samlGate } from '$lib/api/saml';

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

/**
 * The SAML providers a new connection can be linked to. Off when SAML does
 * not run or is not enabled here, so the form offers no link it cannot make,
 * and failed when the read did not answer, so an outage never reads as none.
 */
export type SamlLink =
	| { state: 'ok'; providers: { id: string; name: string }[] }
	| { state: 'off' }
	| { state: 'failed' };

const SAML_OFF_STATES = new Set(['absent', 'locked', 'full', 'forbidden']);

async function samlLink(event: Parameters<PageServerLoad>[0], plugins: Parameters<typeof notRunning>[0]): Promise<SamlLink> {
	if (notRunning(plugins, PLUGIN.saml)) return { state: 'off' };
	try {
		const page = await listSamlProviders(authedClient(event), MAX_LIMIT, 0);
		return { state: 'ok', providers: (page.data ?? []).map((p) => ({ id: p.id, name: p.name })) };
	} catch (err) {
		return SAML_OFF_STATES.has(samlGate(err).state) ? { state: 'off' } : { state: 'failed' };
	}
}

export const load: PageServerLoad = async (event) => {
	const { plugins } = await event.parent();
	const { limit, offset } = pageWindow(event.url, DEFAULT_LIMIT, MAX_LIMIT);

	// The shell says why the page is unavailable while its plugin does not run.
	if (notRunning(plugins, PLUGIN.scim)) {
		return {
			providers: [] as ScimProvider[],
			total: null as number | null,
			limit,
			offset,
			hasMore: false,
			gate: { state: 'absent' } as ScimGate,
			saml: { state: 'off' } as SamlLink,
		};
	}

	const client = authedClient(event);
	let providers: ScimProvider[] = [];
	let total: number | null = null;
	let hasMore = false;
	let gate: ScimGate = SCIM_OK;
	try {
		const page = pageOf(await listProviders(client, limit + 1, offset), limit, offset);
		providers = page.rows;
		total = page.total;
		hasMore = page.hasMore;
	} catch (err) {
		gate = scimGate(err);
	}
	if (gate.state === 'ok') {
		const back = pastEndOffset(providers.length, limit, offset, total);
		if (back !== null) redirect(307, withOffset(event.url, back));
	}

	const saml = gate.state === 'ok' ? await samlLink(event, plugins) : ({ state: 'off' } as SamlLink);
	return { providers, total, limit, offset, hasMore, gate, saml };
};

export const actions: Actions = {
	create: async (event) => {
		await requireRole(event, ['super_admin']);
		const client = authedClient(event);
		const form = await event.request.formData();

		const name = String(form.get('name') ?? '').trim();
		const token = String(form.get('bearer_token') ?? '');
		const action = deprovisionAction(String(form.get('deprovision_action') ?? 'disable'));

		if (!name) return fail(400, { action: 'create', error: 'Name the connection so it can be told from the others.' });
		if (token.length < MIN_TOKEN_LENGTH) {
			return fail(400, {
				action: 'create',
				error: `The token is the whole authentication for a route that creates and deletes accounts. Use at least ${MIN_TOKEN_LENGTH} characters.`,
			});
		}
		if (!action) return fail(400, { action: 'create', error: 'Choose what happens to a deprovisioned account.' });
		const samlProvider = String(form.get('saml_provider_id') ?? '').trim();

		try {
			await createProvider(client, {
				name,
				bearer_token: token,
				deprovision_on_delete: form.get('deprovision_on_delete') === 'true',
				deprovision_action: action,
				...(samlProvider ? { saml_provider_id: samlProvider } : {}),
			});
		} catch (err) {
			return fail(400, { action: 'create', error: actionError(err, 'The connection could not be created.') });
		}
		return { saved: name };
	},

	rotate: async (event) => {
		await requireRole(event, ['super_admin']);
		const client = authedClient(event);
		const form = await event.request.formData();
		const id = String(form.get('id') ?? '');
		const token = String(form.get('new_token') ?? '');
		if (!id) return fail(400, { action: 'rotate', error: 'No connection was named.' });
		if (token.length < MIN_TOKEN_LENGTH) {
			return fail(400, {
				action: 'rotate',
				error: `Use at least ${MIN_TOKEN_LENGTH} characters. The old token stops working the moment this one is stored.`,
			});
		}
		try {
			await rotateToken(client, id, token);
		} catch (err) {
			return fail(400, { action: 'rotate', error: actionError(err, 'The token could not be rotated.') });
		}
		return { rotated: id };
	},

	delete: async (event) => {
		await requireRole(event, ['super_admin']);
		const client = authedClient(event);
		const form = await event.request.formData();
		const id = String(form.get('id') ?? '');
		if (!id) return fail(400, { action: 'delete', error: 'No connection was named.' });
		try {
			await deleteProvider(client, id);
		} catch (err) {
			return fail(400, { action: 'delete', error: actionError(err, 'The connection could not be removed.') });
		}
		return { removed: id };
	},
};
