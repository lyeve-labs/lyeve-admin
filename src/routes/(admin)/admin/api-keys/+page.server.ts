import type { PageServerLoad, Actions } from './$types';
import { fail, error } from '@sveltejs/kit';
import { authedClient, requireRole } from '$lib/server/authz';
import { createClient } from '@lyeve-labs/client';
import { revokeAPIKey, deleteAPIKey } from '@lyeve-labs/client-rest';
import type { APIKey } from '@lyeve-labs/client';
import { actionError, actionFailure } from '$lib/server/action-error';
import {
	createKey,
	keyExpiryProblem,
	keyScopeProblem,
	keyUsage,
	listKeys,
	parseLimits,
	setLimits,
} from '$lib/api/api-keys';
import { cleanScopes, fetchKeyScopeCatalog } from '$lib/api/key-access';
import { listSchemaNames } from '$lib/api/search-settings';
import { pageWindow, rowsOf, totalOf } from '$lib/api/list';
import { sessionToken } from '$lib/server/session-cookie';

export interface UsageSummary {
	api_key_id: string;
	tenant_id: string;
	billing_period: string;
	requests: number;
	bytes_in: number;
	bytes_out: number;
}

export const load: PageServerLoad = async ({ fetch, cookies, parent, url }) => {
	const { user } = await parent();
	if (!user.roles.includes('super_admin')) error(403, 'Requires super_admin role');
	const token = sessionToken({ cookies, url }) ?? '';
	const client = createClient(fetch, { Authorization: `Bearer ${token}` });
	// The endpoint pages at fifty, so a read that names no window shows the
	// first fifty keys as every key the instance has.
	const { limit, offset } = pageWindow(url, 50, 500);
	const res = await listKeys(client, limit, offset).catch(() => [] as APIKey[]);
	const keys = rowsOf(res);
	const total = Math.max(totalOf(res), offset + keys.length);

	// One usage read per key, so the page bound is the request bound too: an
	// unpaged list would fan out one request per key on every load.
	const month = new Date().toISOString().slice(0, 7);
	const usageMap: Record<string, UsageSummary> = {};
	await Promise.all(
		keys.map(async (key) => {
			const u = await keyUsage<UsageSummary>(client, key.id, month);
			if (u) usageMap[key.id] = u;
		}),
	);

	// What the create drawer offers: the routes a key can call, from the
	// engine's own catalog, and the schemas a key can be held to. Either one
	// missing narrows the drawer rather than failing the page.
	const [catalog, schemaNames] = await Promise.all([
		fetchKeyScopeCatalog(client),
		listSchemaNames(client).catch(() => [] as string[]),
	]);

	return { keys, usageMap, month, total, limit, offset, catalog, schemaNames };
};

export const actions: Actions = {
	create: async (event) => {
		await requireRole(event, ['super_admin']);
		const { request } = event;
		const client = authedClient(event);
		const data = await request.formData();

		const roles = data.getAll('roles').map(String).filter(Boolean);
		const scopes = cleanScopes(data.getAll('scopes').map(String));
		// One field per schema from the drawer, and a comma list from a form
		// posted by hand reads the same.
		const schemas = [
			...new Set(
				data
					.getAll('schemas')
					.flatMap((s) => String(s).split(','))
					.map((s) => s.trim())
					.filter(Boolean),
			),
		];
		const expiresRaw = data.get('expires_at')?.toString().trim();
		const expires_at = expiresRaw ? new Date(expiresRaw).toISOString() : null;

		// The submit button is disabled while the field is blank, which is not a
		// rule: a form posted without JavaScript reaches this with no name at all,
		// and the engine's rejection would arrive as a banner attached to nothing.
		const name = String(data.get('name') ?? '').trim();
		if (!name) {
			return fail(400, {
				error: 'Check the highlighted fields.',
				fields: { name: 'Name is required' },
			});
		}
		const parsedLimits = parseLimits(data);
		if ('fields' in parsedLimits) {
			return fail(400, { error: 'Check the highlighted fields.', fields: parsedLimits.fields });
		}
		const { limits } = parsedLimits;
		const expiryProblem = keyExpiryProblem(roles, expiresRaw ?? '');
		if (expiryProblem) {
			return fail(400, {
				error: 'Check the highlighted fields.',
				fields: { expires_at: expiryProblem },
			});
		}

		const scopeProblem = keyScopeProblem(roles, scopes);
		if (scopeProblem) {
			return fail(400, {
				error: 'Check the highlighted fields.',
				fields: { scopes: scopeProblem },
			});
		}

		try {
			const result = await createKey(client, {
				name,
				roles,
				schemas,
				scopes,
				expires_at,
				...(limits.monthly_limit > 0 ? { monthly_limit: limits.monthly_limit } : {}),
				...(limits.daily_limit > 0 ? { daily_limit: limits.daily_limit } : {}),
				...(limits.hourly_limit > 0 ? { hourly_limit: limits.hourly_limit } : {}),
			});
			return { created: true, raw_key: result.raw_key, key_name: result.name };
		} catch (err) {
			return actionFailure(err, 'Failed to create API key');
		}
	},

	limit: async (event) => {
		await requireRole(event, ['super_admin']);
		const data = await event.request.formData();
		const id = String(data.get('id') ?? '');
		if (!id) return fail(400, { error: 'No key was named.' });
		const parsed = parseLimits(data);
		if ('fields' in parsed) {
			return fail(400, { error: 'Check the highlighted fields.', fields: parsed.fields });
		}
		try {
			await setLimits(authedClient(event), id, parsed.limits);
		} catch (err) {
			return actionFailure(err, 'The request limits could not be saved.');
		}
		return { limited: id };
	},

	revoke: async (event) => {
		await requireRole(event, ['super_admin']);
		const { request } = event;
		const client = authedClient(event);
		const data = await request.formData();
		const id = String(data.get('id') ?? '');
		try {
			await revokeAPIKey(id, client);
		} catch (err) {
			return fail(400, { error: actionError(err, 'Failed to revoke API key') });
		}
	},

	delete: async (event) => {
		await requireRole(event, ['super_admin']);
		const { request } = event;
		const client = authedClient(event);
		const data = await request.formData();
		const id = String(data.get('id') ?? '');
		try {
			await deleteAPIKey(id, client);
		} catch (err) {
			return fail(400, { error: actionError(err, 'Failed to delete API key') });
		}
	}
};
