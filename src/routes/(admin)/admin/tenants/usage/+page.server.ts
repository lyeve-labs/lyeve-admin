import type { PageServerLoad, Actions } from './$types';
import { fail } from '@sveltejs/kit';
import { authedClient, requireRole } from '$lib/server/authz';
import { actionFailure } from '$lib/server/action-error';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning } from '$lib/plugins';
import {
	USAGE_OK,
	listQuotas,
	listRequests,
	listTenantUsage,
	deleteQuota,
	quotaFrom,
	reviewRequest,
	upsertQuota,
	usageGate,
	type Quota,
	type QuotaRequest,
	type TenantUsage,
	type UsageGate,
} from '$lib/api/usage';
import { rowsOf, pageWindow, totalOf } from '$lib/api/list';
import { listPeople } from '$lib/server/people';

export const load: PageServerLoad = async (event) => {
	const { plugins, user } = await event.parent();
	// Quotas cover every tenant, so reading and reviewing them is a super
	// admin's. Anybody else is told rather than shown three failed reads.
	const permitted = user.roles.includes('super_admin');

	if (!permitted) {
		return {
			quotas: [] as Quota[],
			quotaTotal: 0,
			limit: 50,
			offset: 0,
			requests: [] as QuotaRequest[],
			usage: [] as TenantUsage[],
			usageRead: false,
			requestsRead: false,
			people: {} as Record<string, string>,
			gate: USAGE_OK as UsageGate,
			permitted,
		};
	}

	const client = authedClient(event);
	// The endpoint pages at 50 by default, so a read that names no window
	// shows the first 50 quotas and calls them every tenant's.
	const { limit, offset } = pageWindow(event.url, 50, 500);
	let quotas: Quota[] = [];
	let quotaTotal = 0;
	// The shell says why the page is unavailable while its plugin does not run.
	let gate: UsageGate = notRunning(plugins, PLUGIN.usage) ? { state: 'absent' } : USAGE_OK;
	if (gate.state === 'ok') {
		try {
			const res = await listQuotas(client, limit, offset);
			quotas = rowsOf(res);
			quotaTotal = Math.max(totalOf(res), offset + quotas.length);
		} catch (err) {
			gate = usageGate(err);
		}
	}

	// Pending requests are the queue somebody has to act on, so an unread list
	// is never drawn as an empty one.
	// A request names its requester by account id, so the directory turns the
	// ids into emails. The page is a super admin's, who may read it.
	const [requests, usage, people] = await Promise.all([
		gate.state === 'ok'
			? listRequests(client)
					.then((r) => ({ rows: rowsOf(r), read: true }))
					.catch(() => ({ rows: [] as QuotaRequest[], read: false }))
			: Promise.resolve({ rows: [] as QuotaRequest[], read: false }),
		// A quota row draws its usage beside its limit. An unread usage list is
		// said once over the table, never drawn as rows that used nothing.
		gate.state === 'ok'
			? listTenantUsage(client)
					.then((u) => ({ rows: rowsOf(u), read: true }))
					.catch(() => ({ rows: [] as TenantUsage[], read: false }))
			: Promise.resolve({ rows: [] as TenantUsage[], read: false }),
		gate.state === 'ok' ? listPeople(client) : Promise.resolve([]),
	]);

	return {
		quotas,
		quotaTotal,
		limit,
		offset,
		requests: requests.rows,
		requestsRead: requests.read,
		usage: usage.rows,
		usageRead: usage.read,
		people: Object.fromEntries([
			...people.map((p) => [p.id, p.email] as const),
			...(user.email ? [[user.id, user.email] as const] : []),
		]) as Record<string, string>,
		gate,
		permitted,
	};
};

export const actions: Actions = {
	review: async (event) => {
		await requireRole(event, ['super_admin']);
		const client = authedClient(event);
		const form = await event.request.formData();
		const id = String(form.get('id') ?? '');
		const decision = String(form.get('decision') ?? '');
		if (!id) return fail(400, { error: 'No request was named.' });
		if (decision !== 'approve' && decision !== 'deny') {
			return fail(400, { error: 'A review is either an approval or a denial.' });
		}
		try {
			await reviewRequest(client, id, decision === 'approve', String(form.get('note') ?? ''));
		} catch (err) {
			return actionFailure(err, 'The request could not be reviewed.');
		}
		return { reviewed: id };
	},

	quota: async (event) => {
		await requireRole(event, ['super_admin']);
		const form = await event.request.formData();
		const tenant = String(form.get('tenant_id') ?? '').trim();
		if (!tenant) {
			return fail(400, { error: 'Check the highlighted fields.', fields: { tenant_id: 'Tenant is required' } });
		}
		try {
			await upsertQuota(authedClient(event), tenant, quotaFrom(form));
		} catch (err) {
			return actionFailure(err, 'The quota could not be saved.');
		}
		return { quotaSaved: tenant };
	},

	clearQuota: async (event) => {
		await requireRole(event, ['super_admin']);
		const form = await event.request.formData();
		const tenant = String(form.get('tenant_id') ?? '').trim();
		if (!tenant) return fail(400, { error: 'No tenant was named.' });
		try {
			await deleteQuota(authedClient(event), tenant);
		} catch (err) {
			return actionFailure(err, 'The quota could not be removed.');
		}
		return { quotaCleared: tenant };
	},
};
