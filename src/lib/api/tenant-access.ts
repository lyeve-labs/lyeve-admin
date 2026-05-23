/**
 * What one tenant may use, and who may act in it.
 *
 * What the instance serves is every tenant's ceiling. A super admin can
 * withhold a plugin from one tenant beneath it, and the engine then refuses
 * the plugin's routes and its feature checks, with every name that falls with
 * it, to that tenant. Withholding never grants: a name the instance does not
 * serve stays off whatever this says.
 *
 * Membership is the other half. An account may act in its home tenant and in
 * every tenant it holds a membership in, with the roles that membership names.
 */
import type { HttpClient, User } from '@lyeve-labs/client';

export interface TenantFeatures {
	tenant: string;
	withheld: string[];
	/** Every plugin the engine accepts in `withheld`. */
	known: string[];
}

export interface TenantMember {
	id: string;
	email: string;
	disabled: boolean;
	/** The tenant is the account's home, so its access cannot be revoked here. */
	home: boolean;
	/** The roles the account holds in this tenant. */
	roles: string[];
}

export interface FeatureChoice {
	name: string;
	available: boolean;
}

const enc = encodeURIComponent;

export function getTenantFeatures(client: HttpClient, tenant: string): Promise<TenantFeatures> {
	return client.get<TenantFeatures>(`/api/admin/tenant-features/${enc(tenant)}`);
}

export function setTenantFeatures(client: HttpClient, tenant: string, withheld: string[]): Promise<TenantFeatures> {
	return client.put<TenantFeatures>(`/api/admin/tenant-features/${enc(tenant)}`, { withheld });
}

export function listTenantMembers(
	client: HttpClient,
	tenant: string,
	limit = 50,
	offset = 0,
): Promise<{ members: TenantMember[]; total: number }> {
	return client.get(`/api/admin/tenant-members/${enc(tenant)}?limit=${limit}&offset=${offset}`);
}

export function grantMembership(client: HttpClient, userId: string, tenant: string, roles: string[]): Promise<unknown> {
	return client.put(`/api/admin/users/${enc(userId)}/memberships`, { tenant_id: tenant, roles });
}

export function revokeMembership(client: HttpClient, userId: string, tenant: string): Promise<unknown> {
	return client.delete(`/api/admin/users/${enc(userId)}/memberships/${enc(tenant)}`);
}

/**
 * The names worth offering: what the license carries, plus anything already
 * withheld so it can be given back. A name the license lacks is left out,
 * because withholding it changes nothing and a switch that does nothing reads
 * as a switch that is broken.
 */
export function featureChoices(known: string[], licensed: string[], withheld: string[]): FeatureChoice[] {
	const offered = new Set(licensed);
	const off = new Set(withheld);
	return known
		.filter((name) => offered.has(name) || off.has(name))
		.sort()
		.map((name) => ({ name, available: !off.has(name) }));
}

/** Names offered but not ticked: the withheld set a submitted form asks for. */
export function withheldFrom(offered: string[], available: string[]): string[] {
	const on = new Set(available);
	return offered.filter((name) => !on.has(name)).sort();
}

/**
 * Finds an account by email. The users endpoint has no email filter, so this
 * walks its pages, which is bounded: past the cap the operator is told to
 * narrow down rather than left waiting.
 */
export async function findUserByEmail(client: HttpClient, email: string, maxPages = 25): Promise<User | null> {
	const want = email.trim().toLowerCase();
	const size = 200;
	for (let page = 0; page < maxPages; page++) {
		const rows = await client.get<User[]>(`/api/admin/users?limit=${size}&offset=${page * size}`);
		const list = Array.isArray(rows) ? rows : [];
		const hit = list.find((u) => u.email.toLowerCase() === want);
		if (hit) return hit;
		if (list.length < size) return null;
	}
	return null;
}
