import type { PageServerLoad, Actions } from './$types';
import { error, fail } from '@sveltejs/kit';
import { createClient, type SchemaField } from '@lyeve-labs/client';
import { getSchemas, getSchema } from '@lyeve-labs/client-rest';
import { authedClient, requireUser } from '$lib/server/authz';
import { actionError } from '$lib/server/action-error';
import { totalOf, type ListEnvelope } from '$lib/api/list';
import { sessionToken } from '$lib/server/session-cookie';

/** One row of the admin content listing, before it is reshaped for the table. */
type EntryRow = {
	id: string;
	title?: string;
	body?: Record<string, unknown>;
	status?: string;
	created_at: string;
	updated_at: string;
};

const DEFAULT_LIMIT = 100;

/**
 * The engine's own ceiling on a page size. It clamps anything larger instead of
 * refusing it, so a bigger request comes back silently truncated and the caller
 * cannot tell a full page from a short one. A limit+1 has-more probe above the
 * ceiling is served short and reads as the end of the collection while rows
 * remain. So the count comes off the envelope, and no request asks for more
 * than the server will give.
 */
const MAX_LIMIT = 500;

/**
 * Entries are listed through the admin API, which holds every entry with its
 * status and history, those written in the console and those written through
 * the Content API alike. The load normalizes the admin rows into the shape the
 * page table expects (data.<field> plus data._status).
 */
export const load: PageServerLoad = async ({ fetch, cookies, params, url }) => {
	const token = sessionToken({ cookies, url }) ?? '';
	const client = createClient(fetch, { Authorization: `Bearer ${token}` });

	const limit = Math.max(
		1,
		Math.min(MAX_LIMIT, Number(url.searchParams.get('limit')) || DEFAULT_LIMIT),
	);
	const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);

	const [schemas, schemaDef, listRes] = await Promise.all([
		getSchemas(client).catch(() => []),
		getSchema(params.schema, client).catch(() => null),
		fetch(
			`/api/admin/content?schema=${encodeURIComponent(params.schema)}&limit=${limit}&offset=${offset}`,
			{ headers: { Authorization: `Bearer ${token}` } },
		),
	]);

	if (!schemaDef) {
		error(404, `Schema "${params.schema}" not found`);
	}

	const empty: ListEnvelope<EntryRow> = { data: [] };
	const listBody: ListEnvelope<EntryRow> = listRes.ok
		? await listRes.json().catch(() => empty)
		: empty;
	const rows = listBody.data ?? [];
	const items = rows.map((e) => ({
		id: e.id,
		created_at: e.created_at,
		updated_at: e.updated_at,
		data: {
			...(e.body && typeof e.body === 'object' ? e.body : {}),
			...(e.title !== undefined ? { title: e.title } : {}),
			_status: e.status ?? 'published',
		} as Record<string, unknown>,
	}));

	await nameRelatedEntries(fetch, token, schemaDef.fields ?? [], items);

	// total_count counts the collection, while rows.length counts this page alone.
	// totalOf falls back to the page length when a response carries no count,
	// and that fallback is smaller than the rows already paged past, which
	// would leave the pager claiming fewer entries than the table shows.
	const total = Math.max(totalOf(listBody), offset + items.length);

	return {
		schemas,
		schemaDef,
		items,
		activeSchema: params.schema,
		limit,
		offset,
		total,
	};
};

type ListedItem = { data: Record<string, unknown> };

/**
 * A link to one entry of another content type is stored as that entry's id,
 * and a column of ids tells the reader nothing. Each linked content type is
 * read once, and every id it holds is replaced by the entry's id and title,
 * the populated shape the table cell already shows by its title. An id the
 * read does not find stays as it is.
 */
async function nameRelatedEntries(
	fetchFn: typeof fetch,
	token: string,
	fields: SchemaField[],
	items: ListedItem[],
): Promise<void> {
	const links = fields.filter(
		(f) => f.field_type === 'relation' && f.relation_to && (f.relation_type ?? 'belongs_to') === 'belongs_to',
	);
	const wanted = new Set<string>();
	for (const f of links) {
		if (items.some((it) => typeof it.data[f.name] === 'string' && it.data[f.name] !== '')) {
			wanted.add(f.relation_to as string);
		}
	}
	if (wanted.size === 0) return;

	const titles = new Map<string, string>();
	await Promise.all(
		[...wanted].map(async (schema) => {
			const res = await fetchFn(
				`/api/admin/content?schema=${encodeURIComponent(schema)}&limit=${MAX_LIMIT}&offset=0`,
				{ headers: { Authorization: `Bearer ${token}` } },
			).catch(() => null);
			if (!res?.ok) return;
			const body: ListEnvelope<EntryRow> = await res.json().catch(() => ({ data: [] }));
			for (const e of body.data ?? []) {
				if (e.id && e.title) titles.set(e.id, e.title);
			}
		}),
	);

	for (const f of links) {
		for (const it of items) {
			const id = it.data[f.name];
			if (typeof id === 'string' && titles.has(id)) {
				it.data[f.name] = { id, title: titles.get(id) };
			}
		}
	}
}

export const actions: Actions = {
	delete: async (event) => {
		await requireUser(event);
		const { request } = event;
		const client = authedClient(event);
		const form = await request.formData();
		const id = form.get('id') as string;
		if (!id) return fail(400, { error: 'Missing id.' });
		try {
			await client.delete(`/api/admin/content/${id}`);
			return { ok: true };
		} catch (err) {
			return fail(400, { error: actionError(err, 'Failed to delete entry') });
		}
	},
};
