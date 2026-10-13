/**
 * The entries a relation field offers, read from the admin listing.
 *
 * The picker is fed one page of the related collection. A collection larger
 * than that page is cut, and a picker that says nothing about it reads as the
 * whole collection. A read that failed is not a collection with no entries, so
 * each read says which of the three it was.
 */
import type { Content, SchemaField } from '@lyeve-labs/client';

/** The most entries a picker is fed. The listing serves no more in one page. */
export const RELATION_PAGE = 500;

export type RelationChoices = {
	items: Content[];
	/** How many entries the related collection holds, as the listing counted them. */
	total: number;
	/** Whether the read failed, so `items` is empty for no reason the collection gave. */
	failed: boolean;
};

/** Whether a picker shows fewer entries than its collection holds. */
export function relationCut(read: RelationChoices | undefined): boolean {
	return !!read && !read.failed && read.total > read.items.length;
}

type ListedRow = { id: string; title?: string };

async function readOne(fetchFn: typeof fetch, token: string, schema: string): Promise<RelationChoices> {
	try {
		const query = new URLSearchParams({ schema, limit: String(RELATION_PAGE), offset: '0' });
		const res = await fetchFn(`/api/admin/content?${query}`, {
			headers: { Authorization: `Bearer ${token}` },
		});
		if (!res.ok) return { items: [], total: 0, failed: true };
		const body = (await res.json()) as { data?: ListedRow[]; total_count?: number };
		const rows = body.data ?? [];
		const items = rows.map((e) => ({
			id: e.id,
			schema_name: schema,
			created_at: '',
			updated_at: '',
			data: { title: e.title ?? '' },
		}));
		const counted = typeof body.total_count === 'number' ? body.total_count : items.length;
		return { items, total: Math.max(counted, items.length), failed: false };
	} catch {
		return { items: [], total: 0, failed: true };
	}
}

/** One read per related collection the fields point at, keyed by its name. */
export async function readRelationChoices(
	fetchFn: typeof fetch,
	token: string,
	fields: SchemaField[],
): Promise<Record<string, RelationChoices>> {
	const names = [
		...new Set(
			fields
				.filter((f) => f.field_type === 'relation' && f.relation_to)
				.map((f) => f.relation_to as string),
		),
	];
	const reads = await Promise.all(names.map((name) => readOne(fetchFn, token, name)));
	return Object.fromEntries(names.map((name, i) => [name, reads[i]]));
}
