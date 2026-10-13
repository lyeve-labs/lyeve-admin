import type { PageServerLoad, Actions } from './$types';
import { createClient } from '@lyeve-labs/client';
import { authedHeaders, requireRole } from '$lib/server/authz';
import { error, fail, redirect } from '@sveltejs/kit';
import { unwrapList } from '@lyeve-labs/client-rest';
import { pageNumber, pageOffset, pastEndOffset, statedTotal, withOffset, type ListEnvelope } from '$lib/api/list';
import { section, type Section } from '$lib/api/gate';
import { UUID, endpointQuery, readFilter } from '$lib/server/audit-filter';
import { sessionToken } from '$lib/server/session-cookie';

export interface AuditEntry {
	id: string;
	action: string;
	resource_type: string;
	resource_id: string;
	user_id: string;
	ip: string;
	user_agent: string;
	created_at: string;
}

const PAGE_SIZE = 50;

export const load: PageServerLoad = async ({ fetch, cookies, url, parent }) => {
	const { user } = await parent();
	if (!user.roles.some((r) => ['super_admin', 'admin'].includes(r))) error(403, 'Requires admin role');
	const token = sessionToken({ cookies, url }) ?? '';
	const client = createClient(fetch, { Authorization: `Bearer ${token}` });
	const limit = PAGE_SIZE;
	// The offset comes from the address, so it is clamped and snapped to a page
	// boundary before the engine sees it or the pager counts from it.
	const asked = Math.max(0, Number(url.searchParams.get('offset')) || 0);
	const offset = pageOffset(pageNumber(asked, limit), limit);
	const filter = readFilter(url);

	// GET /api/admin/audit-log answers with a paginated envelope. Read as a bare
	// array, entries.length is undefined and the table is empty.
	const read = (params: URLSearchParams) =>
		client.get<AuditEntry[] | ListEnvelope<AuditEntry>>(`/api/admin/audit-log?${params}`);

	async function readLog(): Promise<{ entries: AuditEntry[]; stated: number | null }> {
		let res = await read(endpointQuery(filter, limit, offset));
		let entries = unwrapList<AuditEntry>(res);

		// An id names a user or a record, and the box cannot tell which. The actor
		// is asked first because that is the question most often typed. A miss is
		// asked again as a resource id before the page says nothing matched.
		if (entries.length === 0 && filter.q && UUID.test(filter.q)) {
			const params = endpointQuery(filter, limit, offset);
			params.delete('actor');
			params.set('resource_id', filter.q);
			res = await read(params);
			entries = unwrapList<AuditEntry>(res);
		}
		return { entries, stated: statedTotal<AuditEntry>(res) };
	}

	const log = await section(
		readLog(),
		'The audit log could not be read. This is not a report that it is empty.'
	);
	const isSuperAdmin = user.roles.includes('super_admin');

	if (!log.ok) {
		return { entries: log, total: null, offset, limit, isSuperAdmin, filter, actions: [] as string[] };
	}

	const rows = log.value.entries;
	const back = pastEndOffset(rows.length, limit, offset, log.value.stated);
	if (back !== null) redirect(307, withOffset(url, back));

	// The envelope carries the real row count. A count guessed from the page
	// length undercounts a large log and the pager offers too few pages. What
	// has been read is the floor, for an answer that omits the count.
	const total = Math.max(log.value.stated ?? 0, offset + rows.length);
	// The action filter offers what is on the page plus the one in force. The
	// engine keeps no list of the names it has written, so the page is the
	// only source there is.
	const actions = [...new Set([...rows.map((e) => e.action), filter.action].filter(Boolean))].sort();
	const entries: Section<AuditEntry[]> = { ok: true, value: rows };
	return { entries, total, offset, limit, isSuperAdmin, filter, actions };
};

export const actions: Actions = {
	prune: async (event) => {
		await requireRole(event, ['super_admin']);
		const { request, fetch } = event;
		const form = await request.formData();
		const olderThanRaw = form.get('older_than') as string;

		if (!olderThanRaw) {
			return fail(400, { error: 'Missing cut-off date.' });
		}

		const olderThan = `${olderThanRaw}T00:00:00Z`;

		const res = await fetch('/api/admin/audit-log/prune', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				...authedHeaders(event),
			},
			body: JSON.stringify({ older_than: olderThan }),
		});

		if (!res.ok) {
			return fail(res.status, { error: 'Prune failed' });
		}

		const result = await res.json() as { deleted: number };
		redirect(303, `/admin/audit-log?pruned=${result.deleted}`);
	},
};
