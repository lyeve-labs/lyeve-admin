import type { HttpClient } from '@lyeve-labs/client';

/**
 * An account as a column names it and a picker offers it. The tenant is empty
 * for an account that belongs to none, such as the first super admin.
 */
export type Person = { id: string; email: string; tenant_id: string };

/** How many accounts one read asks for. The engine answers no total. */
export const PEOPLE_LIMIT = 200;

/**
 * The first page of accounts, by id and email.
 *
 * The engine answers a bare array with no total, so this is the first page of
 * the directory and not all of it. Where an account past it is shown, its id
 * stands in for the email. A caller the engine refuses the list to gets none,
 * and the page falls back the same way.
 */
export async function listPeople(client: HttpClient): Promise<Person[]> {
	const res = await client.get<unknown>(`/api/admin/users?limit=${PEOPLE_LIMIT}&offset=0`).catch(() => null);
	const rows = Array.isArray(res)
		? res
		: res && typeof res === 'object' && Array.isArray((res as { data?: unknown }).data)
			? ((res as { data: unknown[] }).data)
			: [];
	const out: Person[] = [];
	for (const row of rows) {
		if (!row || typeof row !== 'object') continue;
		const { id, email, tenant_id } = row as { id?: unknown; email?: unknown; tenant_id?: unknown };
		if (typeof id === 'string' && id && typeof email === 'string' && email) {
			out.push({ id, email, tenant_id: typeof tenant_id === 'string' ? tenant_id : '' });
		}
	}
	return out;
}
