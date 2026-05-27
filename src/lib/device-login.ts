/**
 * The pure half of the device sign-in page: reading a code the way a person
 * types it, naming what the engine's refusal means, and the words the page
 * shows for a request.
 */

/** The characters a user code is drawn from. 0, O, 1, I and L read alike and are left out. */
const USER_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** A user code's length without its dash. */
const USER_CODE_LENGTH = 8;

/**
 * A user code as the engine shows it, XXXX-XXXX, or null when the input
 * cannot be one. Any case is accepted, with or without the dash or spaces.
 */
export function normalizeUserCode(raw: string | null | undefined): string | null {
	if (!raw) return null;
	const code = raw.toUpperCase().replace(/[\s-]/g, '');
	if (code.length !== USER_CODE_LENGTH) return null;
	for (const c of code) {
		if (!USER_CODE_ALPHABET.includes(c)) return null;
	}
	return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/** What the page shows once a code has been looked up or decided. */
export type DeviceOutcome = 'approved' | 'denied' | 'expired' | 'decided' | 'unknown' | 'forbidden' | 'error';

/**
 * The outcome an engine refusal stands for. The engine answers 404 for a code
 * it never issued, one that expired and one already decided, and 409 for a
 * second decision. Its message says which, and a message this page does not
 * know reads as unknown rather than as a fault.
 */
export function outcomeForRefusal(status: number, message: string): DeviceOutcome {
	if (status === 409) return 'decided';
	if (status === 401 || status === 403) return 'forbidden';
	if (status === 404) {
		const m = message.toLowerCase();
		if (m.includes('expired')) return 'expired';
		if (m.includes('already')) return 'decided';
		return 'unknown';
	}
	return 'error';
}

/** Roles that may approve a device sign-in. */
const APPROVER_ROLES = ['admin', 'super_admin'];

export function canApprove(roles: readonly string[] | null | undefined): boolean {
	return (roles ?? []).some((r) => APPROVER_ROLES.includes(r));
}

/** `in 9 minutes`, `in under a minute`, or `expired`. */
export function expiresIn(expiresAt: string, now: Date = new Date()): string {
	const at = new Date(expiresAt).getTime();
	if (Number.isNaN(at)) return '';
	const seconds = (at - now.getTime()) / 1000;
	if (seconds <= 0) return 'expired';
	if (seconds < 60) return 'in under a minute';
	const minutes = Math.floor(seconds / 60);
	return `in ${minutes} minute${minutes === 1 ? '' : 's'}`;
}

/** The tenant a session acts in, as the page names it. */
export function tenantLabel(tenantId: string | null | undefined): string {
	return tenantId ? tenantId : 'No tenant (instance-wide account)';
}

/**
 * The sign-in page, told to come back here afterwards. Only the path and the
 * query travel, and the login page accepts nothing but a path under /admin.
 */
export function loginRedirect(pathname: string, search: string): string {
	return `/login?next=${encodeURIComponent(pathname + search)}`;
}

/**
 * Whether a refused approval is about the confirmation rather than the code:
 * a missing or wrong password or MFA code, a used code, or a locked account.
 * Those are answered on the confirmation field and the request stays open.
 */
export function isStepUpRefusal(status: number, message: string): boolean {
	if (status === 429) return true;
	if (status !== 403) return false;
	return /password|mfa code|mfa_code|already used/i.test(message);
}

/** The roles a session would carry, as the page names them. */
export function rolesLabel(roles: readonly string[] | null | undefined): string {
	const names = (roles ?? []).map((r) => (r === 'super_admin' ? 'super admin' : r));
	return names.length ? names.join(', ') : 'none';
}

/** A session lifetime in seconds as `15 minutes` or `1 hour`. */
export function sessionLength(seconds: number | null | undefined): string {
	if (!seconds || seconds <= 0) return '';
	if (seconds % 3600 === 0) {
		const h = seconds / 3600;
		return `${h} hour${h === 1 ? '' : 's'}`;
	}
	const m = Math.max(1, Math.round(seconds / 60));
	return `${m} minute${m === 1 ? '' : 's'}`;
}
