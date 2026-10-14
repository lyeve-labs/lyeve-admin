import type { PageServerLoad, Actions } from './$types';
import { fail, redirect, type ActionFailure } from '@sveltejs/kit';
import { authedClient, requireRole } from '$lib/server/authz';
import { actionFailure } from '$lib/server/action-error';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning } from '$lib/plugins';
import {
	USAGE_OK,
	getTenantUsage,
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
import { section, type Section } from '$lib/api/gate';
import { rowsOf, pageWindow, pastEndOffset, statedTotal, totalOf, withOffset } from '$lib/api/list';
import { listPeople } from '$lib/server/people';

/** What the page says in place of a requests read that failed. */
const REQUESTS_FAILED = 'The requests could not be read. This is not a report that nobody is waiting.';

/** What the page says in place of a usage read that failed. */
const USAGE_FAILED = 'What each tenant used could not be read. This is not a report that nothing was used.';

/** A read the page did not make, said the same way a refusal would be. */
const UNREAD: Section<never> = { ok: false, gate: { state: 'absent' } };

export const load: PageServerLoad = async (event) => {
	const { plugins, user } = await event.parent();
	// The plugin serves the quota reads to an admin as well, scoped to the
	// caller's tenant, and every write to a super admin only. Anybody else is
	// told rather than shown three failed reads.
	const superAdmin = user.roles.includes('super_admin');
	const permitted = superAdmin || user.roles.includes('admin');

	if (!permitted) {
		return {
			quotas: [] as Quota[],
			quotaTotal: 0,
			limit: 50,
			offset: 0,
			requests: UNREAD as Section<QuotaRequest[]>,
			requestTotal: null as number | null,
			usage: UNREAD as Section<TenantUsage[]>,
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
	let back: number | null = null;
	// The shell says why the page is unavailable while its plugin does not run.
	let gate: UsageGate = notRunning(plugins, PLUGIN.usage) ? { state: 'absent' } : USAGE_OK;
	if (gate.state === 'ok') {
		try {
			const res = await listQuotas(client, limit, offset);
			quotas = rowsOf(res);
			quotaTotal = Math.max(totalOf(res), offset + quotas.length);
			// A page past the end is not an instance with no quota set.
			back = pastEndOffset(quotas.length, limit, offset, statedTotal(res));
		} catch (err) {
			gate = usageGate(err);
		}
	}
	if (back !== null) redirect(307, withOffset(event.url, back));

	// Pending requests are the queue somebody has to act on, so an unread list
	// is never drawn as an empty one. Only the pending ones are asked for, so
	// one waiting behind a page of answered requests is still read.
	// A request names its requester by account id, so the directory turns the
	// ids into emails.
	const ok = gate.state === 'ok';
	const [requestRead, usage, people] = await Promise.all([
		ok ? section(listRequests(client, 'pending'), REQUESTS_FAILED) : Promise.resolve(UNREAD),
		// A quota row draws its usage beside its limit. Every tenant's usage is
		// a super admin's read, and an admin reads their own tenant's.
		ok
			? section(
					superAdmin
						? listTenantUsage(client).then((u) => rowsOf(u))
						: getTenantUsage(client, user.tenant_id).then((u) => [u]),
					USAGE_FAILED,
				)
			: Promise.resolve(UNREAD),
		ok ? listPeople(client) : Promise.resolve([]),
	]);
	const requests: Section<QuotaRequest[]> = requestRead.ok ? { ok: true, value: rowsOf(requestRead.value) } : requestRead;

	return {
		quotas,
		quotaTotal,
		limit,
		offset,
		requests,
		requestTotal: requestRead.ok ? statedTotal(requestRead.value) : null,
		usage: usage as Section<TenantUsage[]>,
		people: Object.fromEntries([
			...people.map((p) => [p.id, p.email] as const),
			...(user.email ? [[user.id, user.email] as const] : []),
		]) as Record<string, string>,
		gate,
		permitted,
	};
};

/**
 * A failure that names the action it came from. The page holds one result for
 * every form, so the quota drawer shows only its own failures and the page
 * shows the rest.
 */
function tagged(action: string, failure: ActionFailure<Record<string, unknown>>) {
	return fail(failure.status, { ...failure.data, action });
}

export const actions: Actions = {
	review: async (event) => {
		await requireRole(event, ['super_admin']);
		const client = authedClient(event);
		const form = await event.request.formData();
		const id = String(form.get('id') ?? '');
		const decision = String(form.get('decision') ?? '');
		if (!id) return fail(400, { action: 'review', error: 'No request was named.' });
		if (decision !== 'approve' && decision !== 'deny') {
			return fail(400, { action: 'review', error: 'A review is either an approval or a denial.' });
		}
		try {
			await reviewRequest(client, id, decision === 'approve');
		} catch (err) {
			return tagged('review', actionFailure(err, 'The request could not be reviewed.'));
		}
		return { reviewed: id };
	},

	quota: async (event) => {
		await requireRole(event, ['super_admin']);
		const form = await event.request.formData();
		const tenant = String(form.get('tenant_id') ?? '').trim();
		if (!tenant) {
			return fail(400, { action: 'quota', error: 'Check the highlighted fields.', fields: { tenant_id: 'Tenant is required' } });
		}
		try {
			await upsertQuota(authedClient(event), tenant, quotaFrom(form));
		} catch (err) {
			return tagged('quota', actionFailure(err, 'The quota could not be saved.'));
		}
		return { quotaSaved: tenant };
	},

	clearQuota: async (event) => {
		await requireRole(event, ['super_admin']);
		const form = await event.request.formData();
		const tenant = String(form.get('tenant_id') ?? '').trim();
		if (!tenant) return fail(400, { action: 'clearQuota', error: 'No tenant was named.' });
		try {
			await deleteQuota(authedClient(event), tenant);
		} catch (err) {
			return tagged('clearQuota', actionFailure(err, 'The quota could not be removed.'));
		}
		return { quotaCleared: tenant };
	},
};
