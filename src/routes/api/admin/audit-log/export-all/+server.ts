import type { RequestHandler } from './$types';
import { requireRole } from '$lib/server/authz';
import { proxyAuditDownload } from '$lib/server/audit-download';

/** Every tenant. Super admin only, matching the engine's route. */
export const POST: RequestHandler = async (event) => {
	await requireRole(event, ['super_admin']);
	return proxyAuditDownload(event, '/api/admin/audit-log/export-all', 'audit-log-all-tenants.json');
};
