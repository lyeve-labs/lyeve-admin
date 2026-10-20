/**
 * The entries a relation field offers, read from the admin listing.
 *
 * The picker is fed one page of the related collection. A collection larger
 * than that page is cut, and a picker that says nothing about it reads as the
 * whole collection. A read that failed is not a collection with no entries, so
 * each read says which of the three it was.
 */
import type { HttpClient, SchemaField } from '@lyeve-labs/client';
import type { RelationChoices } from '$lib/components/content/relation-choices';

/** The most entries a picker is fed. The listing serves no more in one page. */
export const RELATION_PAGE = 500;

type ListedRow = { id: string; title?: string };

async function readOne(client: HttpClient, schema: string): Promise<RelationChoices> {
	try {
		const query = new URLSearchParams({ schema, limit: String(RELATION_PAGE), offset: '0' });
		const body = await client.get<{ data?: ListedRow[]; total_count?: number }>(`/api/admin/content?${query}`);
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
	client: HttpClient,
	fields: SchemaField[],
): Promise<Record<string, RelationChoices>> {
	const names = [
		...new Set(
			fields
				.filter((f) => f.field_type === 'relation' && f.relation_to)
				.map((f) => f.relation_to as string),
		),
	];
	const reads = await Promise.all(names.map((name) => readOne(client, name)));
	return Object.fromEntries(names.map((name, i) => [name, reads[i]]));
}
