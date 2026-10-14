import type { StatusTone } from '@lyeve-labs/ui-kit';

/**
 * The tone an HTTP method's badge carries, the same on every page that lists
 * routes. A read is brand, a create success, a change warn and a delete
 * danger, so a write stands out from a read and a delete from both. A method
 * outside that set is neutral.
 */
export function methodTone(method: string): StatusTone {
	switch (method.toUpperCase()) {
		case 'GET':
		case 'HEAD':
			return 'brand';
		case 'POST':
			return 'success';
		case 'PUT':
		case 'PATCH':
			return 'warn';
		case 'DELETE':
			return 'danger';
		default:
			return 'neutral';
	}
}

/** The tone a content entry's status badge carries: live, waiting, or anything else. */
export function entryTone(status: string): StatusTone {
	if (status === 'published') return 'success';
	if (status === 'draft') return 'warn';
	return 'neutral';
}
