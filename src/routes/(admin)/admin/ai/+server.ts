import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/** The section has no landing of its own. The first tab is the destination. */
export const GET: RequestHandler = () => {
	redirect(302, '/admin/ai/providers');
};
