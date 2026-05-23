/**
 * What the multitenant plugin answers about the tenant registry beyond the
 * list, the create, the update and the delete the client package covers.
 */
import type { HttpClient } from '@lyeve-labs/client';

/**
 * Whether this instance may create tenants, as the multitenant plugin says.
 * The plugin asks the same check its create route makes, so a page offers a
 * create only where one would pass. Super admin only.
 */
export async function getProvisioning(client: HttpClient): Promise<boolean> {
	const res = await client.get<{ enabled?: unknown } | null>('/api/admin/tenants/provisioning');
	return res?.enabled === true;
}
