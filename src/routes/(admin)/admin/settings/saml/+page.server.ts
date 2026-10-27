import type { PageServerLoad, Actions } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { authedClient, requireRole } from '$lib/server/authz';
import { actionError } from '$lib/server/action-error';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning } from '$lib/plugins';
import {
	SAML_OK,
	createProvider,
	deleteProvider,
	getTemplate,
	listProviders,
	listTemplates,
	prepareCert,
	rolloverCert,
	samlGate,
	updateProvider,
	type SamlGate,
	type SamlProvider,
	type SamlTemplate,
} from '$lib/api/saml';
import { pageOf, pageWindow, pastEndOffset, withOffset } from '$lib/api/list';

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

/**
 * The attribute map arrives as one textarea, a line per pair, because the
 * number of claims an IdP sends is not known in advance and a fixed set of
 * inputs would be a guess. A line without a separator is dropped rather than
 * stored under an empty key, which would mask every claim that followed it.
 */
function attributeMap(raw: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const line of raw.split('\n')) {
		const at = line.indexOf('=');
		if (at <= 0) continue;
		const key = line.slice(0, at).trim();
		const value = line.slice(at + 1).trim();
		if (key && value) out[key] = value;
	}
	return out;
}

export const load: PageServerLoad = async (event) => {
	const { plugins } = await event.parent();
	const { limit, offset } = pageWindow(event.url, DEFAULT_LIMIT, MAX_LIMIT);

	// The shell says why the page is unavailable while its plugin does not run.
	if (notRunning(plugins, PLUGIN.saml)) {
		return {
			providers: [] as SamlProvider[],
			templates: [] as SamlTemplate[],
			total: null as number | null,
			limit,
			offset,
			hasMore: false,
			gate: { state: 'absent' } as SamlGate,
		};
	}

	const client = authedClient(event);
	let providers: SamlProvider[] = [];
	let total: number | null = null;
	let hasMore = false;
	let gate: SamlGate = SAML_OK;
	try {
		const page = pageOf(await listProviders(client, limit + 1, offset), limit, offset);
		providers = page.rows;
		total = page.total;
		hasMore = page.hasMore;
	} catch (err) {
		gate = samlGate(err);
	}
	if (gate.state === 'ok') {
		const back = pastEndOffset(providers.length, limit, offset, total);
		if (back !== null) redirect(307, withOffset(event.url, back));
	}

	// Templates fill a new provider's protocol settings. The list names them
	// and each one's own read carries the settings. Losing them costs the
	// shortcut, never the list, which is what an operator came to read.
	const templates =
		gate.state === 'ok'
			? await listTemplates(client)
					.then((list) => Promise.all(list.map((t) => getTemplate(client, t.key))))
					.catch((): SamlTemplate[] => [])
			: [];

	return { providers, templates, total, limit, offset, hasMore, gate };
};

export const actions: Actions = {
	create: async (event) => {
		await requireRole(event, ['super_admin']);
		const client = authedClient(event);
		const form = await event.request.formData();

		const name = String(form.get('name') ?? '').trim();
		const entityId = String(form.get('entity_id') ?? '').trim();
		const ssoUrl = String(form.get('sso_url') ?? '').trim();
		const idpCert = String(form.get('idp_cert') ?? '').trim();

		if (!name) return fail(400, { action: 'create', error: 'Name the provider so people know what they are signing in with.' });
		if (!entityId) return fail(400, { action: 'create', error: 'The IdP entity ID is required.' });
		if (!ssoUrl) return fail(400, { action: 'create', error: 'The IdP sign-on URL is required.' });
		if (!idpCert) return fail(400, { action: 'create', error: 'The IdP certificate is required, or no assertion can be verified.' });

		try {
			await createProvider(client, {
				name,
				entity_id: entityId,
				sso_url: ssoUrl,
				slo_url: String(form.get('slo_url') ?? '').trim() || undefined,
				idp_cert: idpCert,
				name_id_format: String(form.get('name_id_format') ?? '').trim() || undefined,
				want_assertions_signed: form.get('want_assertions_signed') === 'true',
				want_response_signed: form.get('want_response_signed') === 'true',
				sign_authn_requests: form.get('sign_authn_requests') === 'true',
				encrypt_assertions: form.get('encrypt_assertions') === 'true',
				attributes_mapping: attributeMap(String(form.get('attributes_mapping') ?? '')),
				enabled: form.get('enabled') === 'true',
			});
		} catch (err) {
			return fail(400, { action: 'create', error: actionError(err, 'The provider could not be created.') });
		}
		return { saved: name };
	},

	update: async (event) => {
		await requireRole(event, ['super_admin']);
		const client = authedClient(event);
		const form = await event.request.formData();
		const id = String(form.get('id') ?? '');
		if (!id) return fail(400, { action: 'update', error: 'No provider was named.' });

		const name = String(form.get('name') ?? '').trim();
		if (!name) return fail(400, { action: 'update', error: 'Name the provider so people know what they are signing in with.' });
		// The plugin's update has no required rule, so a cleared field would be
		// stored and break sign-in through this provider.
		const entityId = String(form.get('entity_id') ?? '').trim();
		const ssoUrl = String(form.get('sso_url') ?? '').trim();
		if (!entityId) return fail(400, { action: 'update', error: 'The IdP entity ID is required.' });
		if (!ssoUrl) return fail(400, { action: 'update', error: 'The IdP sign-on URL is required.' });

		// An empty certificate field means "leave the stored one alone". Sending
		// the empty string would wipe the only thing that verifies an assertion.
		const idpCert = String(form.get('idp_cert') ?? '').trim();

		try {
			await updateProvider(client, id, {
				name,
				entity_id: entityId,
				sso_url: ssoUrl,
				// Sent even when empty: the plugin changes the logout URL only
				// when the key is present, so leaving it out would keep the old one.
				slo_url: String(form.get('slo_url') ?? '').trim(),
				...(idpCert ? { idp_cert: idpCert } : {}),
				name_id_format: String(form.get('name_id_format') ?? '').trim() || undefined,
				want_assertions_signed: form.get('want_assertions_signed') === 'true',
				want_response_signed: form.get('want_response_signed') === 'true',
				sign_authn_requests: form.get('sign_authn_requests') === 'true',
				encrypt_assertions: form.get('encrypt_assertions') === 'true',
				attributes_mapping: attributeMap(String(form.get('attributes_mapping') ?? '')),
				enabled: form.get('enabled') === 'true',
			});
		} catch (err) {
			return fail(400, { action: 'update', error: actionError(err, 'The provider could not be saved.') });
		}
		return { saved: name };
	},

	delete: async (event) => {
		await requireRole(event, ['super_admin']);
		const client = authedClient(event);
		const form = await event.request.formData();
		const id = String(form.get('id') ?? '');
		if (!id) return fail(400, { action: 'delete', error: 'No provider was named.' });
		try {
			await deleteProvider(client, id);
		} catch (err) {
			return fail(400, { action: 'delete', error: actionError(err, 'The provider could not be removed.') });
		}
		return { removed: id };
	},

	prepare: async (event) => {
		await requireRole(event, ['super_admin']);
		const client = authedClient(event);
		const form = await event.request.formData();
		const id = String(form.get('id') ?? '');
		if (!id) return fail(400, { action: 'prepare', error: 'No provider was named.' });
		try {
			await prepareCert(client, id);
		} catch (err) {
			return fail(400, { action: 'prepare', error: actionError(err, 'A new certificate could not be prepared.') });
		}
		return { prepared: id };
	},

	rollover: async (event) => {
		await requireRole(event, ['super_admin']);
		const client = authedClient(event);
		const form = await event.request.formData();
		const id = String(form.get('id') ?? '');
		if (!id) return fail(400, { action: 'rollover', error: 'No provider was named.' });
		try {
			await rolloverCert(client, id);
		} catch (err) {
			return fail(400, { action: 'rollover', error: actionError(err, 'The certificate could not be promoted.') });
		}
		return { rolled: id };
	},
};
