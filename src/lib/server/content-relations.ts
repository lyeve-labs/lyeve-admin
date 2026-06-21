import type { RequestEvent } from '@sveltejs/kit';
import { authedHeaders } from '$lib/server/authz';
/**
 * The many_to_many side of a content entry, written through the admin store.
 *
 * It lives here rather than in the editor because the create page needs the
 * same reconciliation: an entry and its pivot rows have to land in one store.
 * Writing the entry through the admin API and its relations through /api/v1
 * would hand the v1 store an id it has never seen.
 */
/**
 * Reconcile one many_to_many field to the given set of target ids.
 *
 * There is no endpoint that replaces a field's set. `/relationships/{id}`
 * updates a single relationship named by its own id, so it cannot take a
 * field's whole set.
 *
 * The set is reconciled instead: rows whose target is no longer selected are
 * deleted, newly selected targets are created, and rows that are already right
 * are left alone so their sort order survives.
 */
export async function setRelations(
	event: RequestEvent,
	entryID: string,
	fieldName: string,
	ids: string[],
) {
	// Through authedHeaders, not a bag built here: the DELETE and POST below are
	// writes, and event.fetch forwards the session cookie, so the engine applies
	// the double-submit CSRF check and refuses a call carrying Bearer alone.
	const headers = authedHeaders(event);
	const fetch = event.fetch;
	const base = `/api/admin/content/${encodeURIComponent(entryID)}/relationships`;

	const res = await fetch(`${base}?field=${encodeURIComponent(fieldName)}&limit=500&offset=0`, {
		headers,
	});
	if (!res.ok) throw new Error(`could not read the current ${fieldName} relations`);
	const body = await res.json();
	const current = (Array.isArray(body) ? body : (body?.data ?? [])) as {
		id: string;
		target_id: string;
	}[];

	const wanted = new Set(ids);
	const held = new Set(current.map((r) => r.target_id));

	await Promise.all(
		current
			.filter((r) => !wanted.has(r.target_id))
			.map((r) =>
				fetch(`${base}/${encodeURIComponent(r.id)}`, { method: 'DELETE', headers }),
			),
	);

	await Promise.all(
		ids
			.filter((id) => !held.has(id))
			.map((id, i) =>
				fetch(base, {
					method: 'POST',
					headers: { ...headers, 'Content-Type': 'application/json' },
					body: JSON.stringify({
						target_id: id,
						field_name: fieldName,
						rel_type: 'many_to_many',
						sort_order: i,
					}),
				}),
			),
	);
}
