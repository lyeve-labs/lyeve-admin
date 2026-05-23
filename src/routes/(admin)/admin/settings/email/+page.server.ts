import type { Actions, PageServerLoad } from './$types';
import { fail } from '@sveltejs/kit';
import { authedClient, requireUser } from '$lib/server/authz';
import { actionFailure } from '$lib/server/action-error';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning } from '$lib/plugins';
import {
	createEmailProvider,
	deleteEmailProvider,
	listEmailProviders,
	updateEmailProvider,
	type EmailProvider,
} from '$lib/api/email';
import { parseProvider } from '$lib/email/provider-form';
import { ApiError } from '@lyeve-labs/client';
import { sessionToken } from '$lib/server/session-cookie';

/**
 * The engine config keys that make up the fallback transport.
 *
 * This is not a second way to configure the provider pool. These are the
 * engine-level SMTP settings, used when no provider can send: password-reset
 * and magic-link read these keys directly and dial the relay themselves.
 * Removing them answers 200 to every reset request and sends nothing.
 *
 * SMTP_PASS is not marked secret here. Whether a key is a credential is the
 * engine's judgment, and it makes it by name: the admin API withholds the
 * value of anything it treats as secret and marks the setting, so a second
 * list in the client could only disagree with it.
 */
const MAIL_KEYS = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM', 'SMTP_TLS'];

export interface ConfigSetting {
	key: string;
	source: 'env' | 'file' | 'admin' | 'default' | string;
	value?: string;
	origin?: string;
	editable: boolean;
	secret?: boolean;
}

interface ConfigProvenance {
	settings: ConfigSetting[];
}

interface ConfigRefusal {
	key: string;
	reason: string;
	origin?: string;
}

/**
 * Read the fallback transport, or null when this session may not see it.
 *
 * Reading it needs a super admin, and the provider pool above it does not, so
 * a missing answer hides that section rather than failing the page: an admin
 * who can manage providers should not be locked out of the page that lists
 * them by a section they cannot read.
 */
async function loadMail(event: Parameters<PageServerLoad>[0], superAdmin: boolean) {
	if (!superAdmin) return null;
	if (!sessionToken(event)) return null;

	const provenance = await authedClient(event)
		.get<ConfigProvenance>('/api/admin/config')
		.catch(() => null);
	if (!provenance) return null;

	// A key no layer has ever supplied is absent from the provenance list, and
	// an absent mail setting is the ordinary case on a fresh instance. Fill the
	// gaps so every field renders, rather than showing a form that grows rows
	// as it is filled in.
	const known = new Map(provenance.settings.map((s) => [s.key, s]));
	return MAIL_KEYS.map(
		(key) => known.get(key) ?? ({ key, source: 'default', editable: true } as ConfigSetting)
	);
}

export const load: PageServerLoad = async (event) => {
	const user = await requireUser(event);
	const { plugins } = await event.parent();
	const none: EmailProvider[] = [];
	// The shell says why the page is unavailable while its plugin does not run.
	if (notRunning(plugins, PLUGIN.email)) return { mail: null, providers: none, unavailable: false };
	const mail = await loadMail(event, user.roles.includes('super_admin'));
	try {
		return {
			mail,
			providers: await listEmailProviders(authedClient(event)),
			unavailable: false,
		};
	} catch {
		return { mail, providers: none, unavailable: true };
	}
};

const text = (data: FormData, key: string): string => String(data.get(key) ?? '').trim();

export const actions: Actions = {
	create: async (event) => {
		await requireUser(event);
		const parsed = parseProvider(await event.request.formData(), false);
		if ('error' in parsed) return fail(400, { error: parsed.error });
		try {
			await createEmailProvider(authedClient(event), parsed.body);
		} catch (err) {
			return actionFailure(err, 'Failed to create the provider.');
		}
	},

	update: async (event) => {
		await requireUser(event);
		const data = await event.request.formData();
		const id = text(data, 'id');
		if (!id) return fail(400, { error: 'Which provider to update is missing.' });
		const parsed = parseProvider(data, true);
		if ('error' in parsed) return fail(400, { error: parsed.error });
		try {
			await updateEmailProvider(authedClient(event), id, parsed.body);
		} catch (err) {
			return actionFailure(err, 'Failed to update the provider.');
		}
	},

	delete: async (event) => {
		await requireUser(event);
		const data = await event.request.formData();
		try {
			await deleteEmailProvider(authedClient(event), text(data, 'id'));
		} catch (err) {
			return actionFailure(err, 'Failed to delete the provider.');
		}
	},

	// One setting per submission. Sending the whole form would clear every
	// credential the operator did not retype, because a blank secret is how the
	// engine is told to unset one.
	saveSetting: async (event) => {
		await requireUser(event);
		if (!sessionToken(event)) return fail(401, { error: 'Not authenticated' });

		const data = await event.request.formData();
		const key = text(data, 'key');
		if (!key) return fail(400, { error: 'Setting name is required' });
		if (!MAIL_KEYS.includes(key)) return fail(400, { key, error: 'Not a mail setting' });

		const value = data.get('value')?.toString() ?? '';
		const secret = text(data, 'secret') === 'true';
		if (secret && value === '') {
			return fail(400, { key, error: 'Enter a value, or clear it from Configuration' });
		}

		try {
			const result = await authedClient(event).put<{
				refused?: ConfigRefusal[];
			}>('/api/admin/config', { values: { [key]: value } });

			const refusal = result.refused?.[0];
			if (refusal) {
				const where = refusal.origin ? ` (${refusal.origin})` : '';
				return fail(409, { key, error: `${refusal.reason}${where}` });
			}
			return { success: true, key };
		} catch (e) {
			if (e instanceof ApiError) return fail(e.status, { key, error: e.message });
			return fail(500, { key, error: 'Could not save the setting' });
		}
	},
};
