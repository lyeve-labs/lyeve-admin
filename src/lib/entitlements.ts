import type { Entitlements } from '@lyeve-labs/client';

/**
 * What `GET /api/admin/entitlements` returns: the plan, its state, the feature
 * list and the numeric caps, and nothing that identifies the license itself.
 *
 * Re-exported rather than redeclared so this stays the admin's one import site
 * for the type while the package owns its shape.
 */
export type { Entitlements };

/**
 * The entitlements answer as the license pages read it. The package names
 * three sources for `license_source`, and a license module may name its own,
 * so the field is widened to any string here. Every other field is the
 * package's.
 */
export type LicenseEntitlements = Omit<Entitlements, 'license_source'> & {
	/** What renews the license, in the license module's words. Absent with no license. */
	license_source?: string;
};

/**
 * Whether the engine says the build links a license module, the part that
 * has a license to show and serves the license page. An engine that does
 * not say, and a reader the entitlements are refused to, read as none.
 */
export function hasLicenseModule(ent: LicenseEntitlements | null | undefined): boolean {
	return ent?.license_module === true;
}

/**
 * Used when the entitlements endpoint cannot be read: every gate reads closed.
 */
export const NO_ENTITLEMENTS: Entitlements = {
	plan: '',
	state: '',
	features: [],
	tenant_quota: 0,
};

/**
 * Whether the active license grants a feature to the signed-in tenant. Fails
 * closed on nullish input.
 *
 * `features` is the license and answers for the whole instance. `withheld`
 * is what a super admin took away from this tenant, already expanded by the
 * engine to every name that falls with it, and the engine refuses those
 * routes, so a page gated on one would only draw refusals.
 */
export function hasFeature(ent: LicenseEntitlements | null | undefined, feature: string): boolean {
	if (!(ent?.features?.includes(feature) ?? false)) return false;
	return !(ent?.withheld?.includes(feature) ?? false);
}
