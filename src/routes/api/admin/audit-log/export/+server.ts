import type { RequestHandler } from './$types';
import { requireRole } from '$lib/server/authz';
import { proxyAuditDownload } from '$lib/server/audit-download';

/** The caller's own tenant. Admin-gated, matching the engine's route. */
export const POST: RequestHandler = async (event) => {
	await requireRole(event, ['admin', 'super_admin']);
	return proxyAuditDownload(event, '/api/admin/audit-log/export', 'audit-log.json');
};
