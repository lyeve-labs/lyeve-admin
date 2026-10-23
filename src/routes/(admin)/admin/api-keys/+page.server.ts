import type { PageServerLoad, Actions } from './$types';
import { fail, error, redirect } from '@sveltejs/kit';
import { authedClient, loadUser, requireRole } from '$lib/server/authz';
import { revokeAPIKey, deleteAPIKey } from '@lyeve-labs/client-rest';
import type { APIKey } from '@lyeve-labs/client';
import { actionError, actionFailure } from '$lib/server/action-error';
import {
	createKey,
	keyExpiryProblem,
	keyScopeProblem,
	keysUsage,
	listKeys,
	parseLimits,
	setLimits,
} from '$lib/api/api-keys';
import { cleanScopes, fetchKeyScopeCatalog } from '$lib/api/key-access';
import { listSchemaNames } from '$lib/api/search-settings';
import { pageWindow, pastEndOffset, rowsOf, statedTotal, totalOf, withOffset } from '$lib/api/list';
import { section, type Section } from '$lib/api/gate';

/**
 * A failed write tagged with the action that made it. Every action answers
 * into one `form`, and the page shows each failure only where it belongs.
 */
function failed(action: 'create' | 'limit' | 'revoke' | 'delete', err: unknown, fallback: string) {
	const f = actionFailure(err, fallback);
	return fail(f.status, { ...f.data, action });
}

export interface UsageSummary {
	api_key_id: string;
	tenant_id: string;
	billing_period: string;
	requests: number;
	bytes_in: number;
	bytes_out: number;
}

export const load: PageServerLoad = async (event) => {
	const { url } = event;
	const user = await loadUser(event);
	if (!user.roles.includes('super_admin')) error(403, 'Requires super_admin role');
	const client = authedClient(event);
	// The endpoint pages at fifty, so a read that names no window shows the
	// first fifty keys as every key the instance has.
	const { limit, offset } = pageWindow(url, 50, 500);
	const read = await section(
		listKeys(client, limit, offset),
		'The API keys could not be read. This is not a report that there are none.'
	);
	const rows = read.ok ? rowsOf(read.value) : [];
	if (read.ok) {
		const back = pastEndOffset(rows.length, limit, offset, statedTotal(read.value));
		if (back !== null) redirect(307, withOffset(url, back));
	}
	const keys: Section<APIKey[]> = read.ok ? { ok: true, value: rows } : read;
	const total = read.ok ? Math.max(totalOf(read.value), offset + rows.length) : 0;

	// One usage read for the page, split only where the ids outgrow a URL. A
	// 404 is an engine without usage metering, and the cells say nothing. Any
	// other failure leaves every figure unknown, which the cells say rather
	// than showing no use. A key the plugin leaves out of its answer is one it
	// does not count.
	const month = new Date().toISOString().slice(0, 7);
	const usageMap: Record<string, UsageSummary> = {};
	let usageUnknown: string[] = [];
	if (rows.length > 0) {
		const usage = await section(
			keysUsage<UsageSummary>(
				client,
				rows.map((k) => k.id),
				month,
			),
			'The usage could not be read.',
		);
		if (usage.ok) {
			for (const u of Array.isArray(usage.value) ? usage.value : []) usageMap[u.api_key_id] = u;
		} else if (usage.gate.state !== 'absent') {
			usageUnknown = rows.map((k) => k.id);
		}
	}

	// What the create drawer offers: the routes a key can call, from the
	// engine's own catalog, and the schemas a key can be held to. A missing
	// route narrows the drawer. A failed read narrows it too, and the drawer
	// says which part could not be read.
	const [catalogRead, schemaRead] = await Promise.all([
		section(fetchKeyScopeCatalog(client), 'The route catalog could not be read.'),
		section(listSchemaNames(client), 'The schemas could not be read.'),
	]);
	const catalog = catalogRead.ok ? catalogRead.value : null;
	const schemaNames = schemaRead.ok ? schemaRead.value : [];

	return {
		keys,
		usageMap,
		usageUnknown,
		month,
		total,
		limit,
		offset,
		catalog,
		catalogFailed: !catalogRead.ok && catalogRead.gate.state !== 'absent',
		schemaNames,
		schemasFailed: !schemaRead.ok,
	};
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
				action: 'create',
				error: 'Check the highlighted fields.',
				fields: { name: 'Name is required' },
			});
		}
		const parsedLimits = parseLimits(data);
		if ('fields' in parsedLimits) {
			return fail(400, { action: 'create', error: 'Check the highlighted fields.', fields: parsedLimits.fields });
		}
		const { limits } = parsedLimits;
		const expiryProblem = keyExpiryProblem(roles, expiresRaw ?? '');
		if (expiryProblem) {
			return fail(400, {
				action: 'create',
				error: 'Check the highlighted fields.',
				fields: { expires_at: expiryProblem },
			});
		}

		const scopeProblem = keyScopeProblem(roles, scopes);
		if (scopeProblem) {
			return fail(400, {
				action: 'create',
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
			return failed('create', err, 'Failed to create API key');
		}
	},

	limit: async (event) => {
		await requireRole(event, ['super_admin']);
		const data = await event.request.formData();
		const id = String(data.get('id') ?? '');
		if (!id) return fail(400, { action: 'limit', error: 'No key was named.' });
		const parsed = parseLimits(data);
		if ('fields' in parsed) {
			return fail(400, { action: 'limit', error: 'Check the highlighted fields.', fields: parsed.fields });
		}
		try {
			await setLimits(authedClient(event), id, parsed.limits);
		} catch (err) {
			return failed('limit', err, 'The request limits could not be saved.');
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
			return fail(400, { action: 'revoke', error: actionError(err, 'Failed to revoke API key') });
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
			return fail(400, { action: 'delete', error: actionError(err, 'Failed to delete API key') });
		}
	}
};
