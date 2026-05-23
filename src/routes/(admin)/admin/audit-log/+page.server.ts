import type { PageServerLoad, Actions } from './$types';
import { createClient } from '@lyeve-labs/client';
import { authedHeaders, requireRole } from '$lib/server/authz';
import { error, fail, redirect } from '@sveltejs/kit';
import { unwrapList } from '@lyeve-labs/client-rest';
import { totalOf, type ListEnvelope } from '$lib/api/list';
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
	const offset = Number(url.searchParams.get('offset') ?? 0);
	const limit = PAGE_SIZE;
	const filter = readFilter(url);

	// GET /api/admin/audit-log answers with a paginated envelope. Read as a bare
	// array, entries.length is undefined and the table is empty.
	const read = (params: URLSearchParams) =>
		client
			.get<AuditEntry[] | ListEnvelope<AuditEntry>>(`/api/admin/audit-log?${params}`)
			.catch(() => [] as AuditEntry[]);
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

	// The envelope carries the real row count. A count guessed from the page
	// length undercounts a large log and the pager offers too few pages. What
	// has been read is the floor, for an answer that omits the count.
	const total = Math.max(totalOf<AuditEntry>(res), offset + entries.length);
	const isSuperAdmin = user.roles.includes('super_admin');
	// The action filter offers what is on the page plus the one in force. The
	// engine keeps no list of the names it has written, so the page is the
	// only source there is.
	const actions = [...new Set([...entries.map((e) => e.action), filter.action].filter(Boolean))].sort();
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
