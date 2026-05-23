import { redirect } from '@sveltejs/kit';
import { authedClient } from '$lib/server/authz';
import type { LayoutServerLoad } from './$types';
import { getMe, getEntitlements, getPluginStatus, type PluginStatusReport } from '@lyeve-labs/client-rest';
import { NO_ENTITLEMENTS, type LicenseEntitlements } from '$lib/entitlements';
import { clearSessionCookie, sessionToken } from '$lib/server/session-cookie';
import { pendingMigrations } from '$lib/api/migrate';
import { getCustomization, NO_CUSTOMIZATION, type Customization } from '$lib/api/customization';
import { brandOf } from '$lib/brand';
import { NO_LICENSING, readLicensing } from '$lib/api/license';
import { readRunningPlugins } from '$lib/api/plugins-running';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning, pluginSetOf } from '$lib/plugins';

/**
 * Roles the engine lets read and apply the DDL queue. The queue holds every
 * tenant's pending drops on tables they share, so it is the super admin's.
 */
const MIGRATOR_ROLES = ['super_admin'];

/** Roles the engine gives the plugin status report and the entitlements to. */
const OPERATOR_ROLES = ['admin', 'super_admin'];

/**
 * What the shell knows about the DDL log: the count, null inside it when the
 * engine did not answer, and null instead of it for a session that could not
 * apply a migration anyway.
 */
export type MigrationStatus = { pending: number | null } | null;

export const load: LayoutServerLoad = async (event) => {
	const { cookies } = event;

	const token = sessionToken(event);
	if (!token) {
		redirect(302, '/login');
	}

	const authed = authedClient(event);
	const user = await getMe(authed).catch(() => null);
	if (!user) {
		clearSessionCookie(event);
		redirect(302, '/login');
	}

	/*
	 * The shell's reads, in two rounds.
	 *
	 * The first says what the instance is. Entitlements decide the license's
	 * answers, and an endpoint that cannot be read reads as no features. The
	 * running list decides which plugin pages exist at all, for every role. An
	 * operator also reads the plugin status, which says why a plugin does not
	 * run, so a page reached by its URL can say so.
	 *
	 * The second round asks only the parts that are there. The migration count
	 * is the schema plugin's and the tenant's frame is the multitenant
	 * plugin's, so an engine without them is not asked for either. The links
	 * and the renewal belong to the license module, and the entitlements say
	 * whether the build links one.
	 *
	 * None of this re-runs when the reader moves between admin pages: the load
	 * reads no url and no params, so SvelteKit keeps the shell's data across a
	 * client-side navigation and asks the engine again only on a fresh document
	 * or after a write invalidates.
	 */
	const operator = user.roles.some((role) => OPERATOR_ROLES.includes(role));
	const readEntitlements: Promise<LicenseEntitlements> = getEntitlements(authed).catch(() => NO_ENTITLEMENTS);
	const [entitlements, running, status] = await Promise.all([
		readEntitlements,
		readRunningPlugins(authed),
		operator
			? getPluginStatus(authed).catch((): PluginStatusReport | null => null)
			: Promise.resolve<PluginStatusReport | null>(null),
	]);
	const withheld = entitlements.withheld ?? [];
	const plugins = pluginSetOf({ running, status, operator, withheld });

	/*
	 * A session that cannot apply a migration is not asked about one. The apply
	 * endpoint is super_admin only, so for anyone else the count would cost a
	 * request per page load and a control they would be refused.
	 */
	const canMigrate = user.roles.some((role) => MIGRATOR_ROLES.includes(role));
	const [migrations, customization, licensing] = await Promise.all([
		canMigrate && !notRunning(plugins, PLUGIN.schema)
			? // An engine that does not answer leaves the count unknown, which the
				// chip says out loud. Reading a failure as zero would paint it green
				// and claim the database is in step with schemas nobody checked.
				pendingMigrations(authed)
					.then((pending): MigrationStatus => ({ pending }))
					.catch((): MigrationStatus => ({ pending: null }))
			: Promise.resolve<MigrationStatus>(null),
		// The tenant's own frame: name, logo, accent, menu and pages. A failed
		// read is the stock admin, never a broken one.
		notRunning(plugins, PLUGIN.multitenant)
			? Promise.resolve(NO_CUSTOMIZATION)
			: Promise.resolve()
					.then(() => getCustomization(authed))
					.catch((): Customization => NO_CUSTOMIZATION),
		// Every role asks, because the support link sits in every reader's
		// account menu and the entitlements are refused below admin. Only an
		// engine that says it links no license module is spared the request.
		// One without the route answers 404, which reads as no links.
		entitlements.license_module === false ? Promise.resolve(NO_LICENSING) : readLicensing(authed),
	]);

	// The session tenant's brand, in the shape every page reads it in. It
	// replaces the public copy the root layout would read by address.
	const brand = brandOf(customization.settings.brand);

	return { user, entitlements, plugins, pluginStatus: status, migrations, customization, licensing, brand };
};
