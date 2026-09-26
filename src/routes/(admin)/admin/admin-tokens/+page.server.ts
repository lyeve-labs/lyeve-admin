import type { Actions, PageServerLoad } from './$types';
import { error, fail } from '@sveltejs/kit';
import { ApiError } from '@lyeve-labs/client';
import { listTenants, type Tenant } from '@lyeve-labs/client-rest';
import { authedClient, requireRole } from '$lib/server/authz';
import {
	allowedIPsProblem,
	createAdminToken,
	describeRefusal,
	listAdminGrants,
	listAdminTokenRequests,
	listAdminTokens,
	parseAllowedIPs,
	resolveExpiry,
	revokeAdminToken,
	rotateAdminToken,
	type AdminGrant,
	type AdminToken,
	type AdminTokenIssued,
	type AdminTokenRequest,
	type StepUp,
} from '$lib/api/admin-tokens';
import { pageWindow, rowsOf, totalOf } from '$lib/api/list';

/** The engine pages this list at fifty and refuses more than a hundred. */
const PAGE = 50;
const MAX_PAGE = 100;
const OWNER_ROLES = ['admin', 'super_admin'];

export interface RequestLog {
	token: string;
	rows: AdminTokenRequest[];
	total: number;
	limit: number;
	offset: number;
	error?: string;
}

function loadError(err: unknown, what: string): string {
	if (err instanceof ApiError && err.status === 503) return 'The database is unavailable, so the list could not be read. Try again in a moment.';
	return `The ${what} could not be read. Reload the page to try again.`;
}

export const load: PageServerLoad = async (event) => {
	const { parent, url } = event;
	const { user } = await parent();
	if (!user.roles.some((r) => OWNER_ROLES.includes(r))) error(403, 'Requires the admin or super_admin role');
	const superAdmin = user.roles.includes('super_admin');
	const client = authedClient(event);
	const { limit, offset } = pageWindow(url, PAGE, MAX_PAGE);

	let listError = '';
	const [list, grants, mfa, tenants] = await Promise.all([
		listAdminTokens(client, limit, offset).catch((err) => {
			listError = loadError(err, 'token list');
			return null;
		}),
		listAdminGrants(client).catch((): AdminGrant[] => []),
		// Which step-up the engine will ask for. An unreadable status leaves it
		// unknown: the form asks for the password, and an engine that wants a
		// code says so and the form switches.
		client
			.get<{ enabled: boolean }>('/api/admin/mfa/status')
			.then((s) => s.enabled === true)
			.catch(() => false),
		superAdmin
			? listTenants(client, 500, 0)
					.then((r) => r.items)
					.catch((): Tenant[] => [])
			: Promise.resolve<Tenant[]>([]),
	]);
	const tokens: AdminToken[] = rowsOf(list);
	const total = Math.max(totalOf(list), offset + tokens.length);

	// The request log opens in a drawer over the list, and the URL names it
	// so the load reads it and the pager inside it works as links.
	let log: RequestLog | null = null;
	const logToken = url.searchParams.get('log');
	if (logToken) {
		const logOffset = Math.max(0, Number(url.searchParams.get('log_offset')) || 0);
		log = await listAdminTokenRequests(client, logToken, PAGE, logOffset)
			.then((res) => {
				const rows = rowsOf(res);
				return { token: logToken, rows, total: Math.max(totalOf(res), logOffset + rows.length), limit: PAGE, offset: logOffset };
			})
			.catch((err) => ({
				token: logToken,
				rows: [],
				total: 0,
				limit: PAGE,
				offset: logOffset,
				error: err instanceof ApiError && err.status === 404 ? 'This token is not one you can see.' : loadError(err, 'request log'),
			}));
	}

	return {
		tokens,
		total,
		limit,
		offset,
		listError,
		grants,
		mfaEnrolled: mfa,
		tenants: tenants.filter((t) => !t.archived).map((t) => ({ slug: t.slug, name: t.name })),
		log,
		adminOrigin: url.origin,
	};
};

/** The step-up answer the form carries, or the field it is missing from. */
function stepUpOf(data: FormData): { stepUp: StepUp; step: 'password' | 'mfa_code' } | { missing: Record<string, string>; step: 'password' | 'mfa_code' } {
	const step = data.get('step') === 'mfa_code' ? 'mfa_code' : 'password';
	if (step === 'mfa_code') {
		const code = String(data.get('mfa_code') ?? '').trim();
		if (!code) return { step, missing: { mfa_code: 'Enter the current code from your authenticator app.' } };
		return { step, stepUp: { mfa_code: code } };
	}
	const password = String(data.get('password') ?? '');
	if (!password) return { step, missing: { password: 'Enter your current password.' } };
	return { step, stepUp: { password } };
}

/** What a successful create or rotate hands the page: the token, once. */
function issued(t: AdminTokenIssued, rotated: boolean) {
	return { issued: { token: t.token, name: t.name, expires_at: t.expires_at, rotated } };
}

function refused(err: unknown, step: 'password' | 'mfa_code', action: string) {
	const status = err instanceof ApiError ? err.status : 500;
	const refusal = describeRefusal(status, err instanceof ApiError ? err.message : '', step);
	return fail(status === 429 ? 429 : 400, { action, ...refusal });
}

export const actions: Actions = {
	create: async (event) => {
		await requireRole(event, OWNER_ROLES);
		const data = await event.request.formData();
		const fields: Record<string, string> = {};

		const name = String(data.get('name') ?? '').trim();
		if (!name) fields.name = 'Name the token.';
		else if (name.length > 255) fields.name = 'Name the token in at most 255 characters.';
		const grants = data.getAll('grants').map(String).filter(Boolean);
		if (grants.length === 0) fields.grants = 'Choose at least one grant.';
		const expiry = resolveExpiry(String(data.get('expiry') ?? ''), String(data.get('expires_at') ?? ''));
		if ('problem' in expiry) fields.expires_at = expiry.problem;
		const ipText = String(data.get('allowed_ips') ?? '');
		const ipProblem = allowedIPsProblem(ipText);
		if (ipProblem) fields.allowed_ips = ipProblem;
		const step = stepUpOf(data);
		if ('missing' in step) Object.assign(fields, step.missing);
		if (Object.keys(fields).length > 0 || 'problem' in expiry || 'missing' in step) {
			return fail(400, { action: 'create', error: 'Check the highlighted fields.', fields });
		}

		const tenant = String(data.get('tenant_id') ?? '').trim();
		try {
			const t = await createAdminToken(authedClient(event), {
				name,
				grants,
				expires_at: expiry.expires_at,
				allowed_ips: parseAllowedIPs(ipText).entries,
				...(tenant ? { tenant_id: tenant } : {}),
				...step.stepUp,
			});
			return issued(t, false);
		} catch (err) {
			return refused(err, step.step, 'create');
		}
	},

	rotate: async (event) => {
		await requireRole(event, OWNER_ROLES);
		const data = await event.request.formData();
		const id = String(data.get('id') ?? '');
		const fields: Record<string, string> = {};
		const expiry = resolveExpiry(String(data.get('expiry') ?? ''), String(data.get('expires_at') ?? ''));
		if ('problem' in expiry) fields.expires_at = expiry.problem;
		const step = stepUpOf(data);
		if ('missing' in step) Object.assign(fields, step.missing);
		if (!id || 'problem' in expiry || 'missing' in step) {
			return fail(400, { action: 'rotate', error: 'Check the highlighted fields.', fields });
		}
		try {
			const t = await rotateAdminToken(authedClient(event), id, { expires_at: expiry.expires_at, ...step.stepUp });
			return issued(t, true);
		} catch (err) {
			return refused(err, step.step, 'rotate');
		}
	},

	revoke: async (event) => {
		await requireRole(event, OWNER_ROLES);
		const data = await event.request.formData();
		const id = String(data.get('id') ?? '');
		try {
			await revokeAdminToken(authedClient(event), id);
			return { revoked: true };
		} catch (err) {
			const status = err instanceof ApiError ? err.status : 500;
			const message =
				status === 409
					? 'This token was already revoked.'
					: status === 403
						? 'Only the owner of a token or a super admin can revoke it.'
						: status === 503
							? 'The database is unavailable. Try again in a moment.'
							: 'The token could not be revoked. Try again.';
			return fail(400, { action: 'revoke', error: message, fields: {} });
		}
	},
};
