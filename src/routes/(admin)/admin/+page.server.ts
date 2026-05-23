import type { PageServerLoad, Actions } from './$types';
import { getCustomPage } from '$lib/api/customization';
import { resolveBlocks } from '$lib/server/custom-blocks';
import { getDashboardLayout } from '$lib/api/custom-dashboard';
import { resolveWidgets } from '$lib/server/dashboard-widgets';
import { PLUGIN } from '$lib/plugin-names';
import { runs } from '$lib/plugins';
import { fail, redirect } from '@sveltejs/kit';
import { createClient } from '@lyeve-labs/client';
import type { DeadLetter, GlobalHealthStats, Schema } from '@lyeve-labs/client';
import {
	getEndpoints,
	getGlobalHealth,
	getLogVolume,
	getSchemas,
	getSummary,
	getTrend,
	type BreakdownItem,
	type LogEntry,
	type LogSearchResponse,
	type Summary,
} from '@lyeve-labs/client-rest';
import { applyMigrations } from '$lib/api/migrate';
import { rowsOf, statedTotal, type ListEnvelope } from '$lib/api/list';
import { actionError } from '$lib/server/action-error';
import { localPath } from '$lib/server/local-path';
import { authedClient, requireRole } from '$lib/server/authz';
import { WINDOWS, windowOf } from '$lib/dashboard';
import { attentionOf, hoursOf, type TopEndpoint } from '$lib/server/dashboard';
import { getSecurityControls } from '$lib/api/security';
import { hasLicenseModule } from '$lib/entitlements';
import type { AuditEntry } from './audit-log/+page.server';
import type { Job } from './jobs/+page.server';
import { sessionToken } from '$lib/server/session-cookie';

/** What the content plugin lists for an entry, as far as the dashboard reads it. */
export interface RecentEntry {
	id: string;
	schema: string;
	title: string;
	slug: string;
	status: string;
	updated_at: string;
}

/** How many rows each "what changed" list shows. */
const RECENT = 5;

export const load: PageServerLoad = async ({ fetch, cookies, parent, url }) => {
	const { user, entitlements, customization, plugins } = await parent();
	const token = sessionToken({ cookies, url }) ?? '';
	const client = createClient(fetch, { Authorization: `Bearer ${token}` });
	const isAdmin = user.roles.includes('admin') || user.roles.includes('super_admin');

	/*
	 * Every windowed read is told the window. The analytics summary with no
	 * `from` labels its range "24h ago" and then sums every retained hour, so
	 * a tile saying "Requests, 24h" would report the retention period.
	 * The hour is truncated so the first bucket of the trend is a whole one.
	 */
	const window = windowOf(url);
	const now = new Date();
	const since = new Date(now);
	since.setUTCMinutes(0, 0, 0);
	since.setUTCHours(since.getUTCHours() - WINDOWS[window]);
	const from = since.toISOString();

	/*
	 * A tenant that composed its own dashboard sees that instead of the
	 * stock panels, so the stock reads are skipped rather than made and
	 * thrown away. A layout that cannot be read falls back to the stock
	 * dashboard: an unreadable customization is not an empty page.
	 */
	const layout = customization?.entitled ? await getDashboardLayout(client).catch(() => null) : null;
	const stock = !layout?.custom;
	const composed = layout?.custom
		? await resolveWidgets(client, layout.widgets, user.roles, plugins, now)
		: null;

	/*
	 * A tile, a list and the read behind them are drawn only while the plugin
	 * that answers the read runs. An engine without it is not asked, and the
	 * dashboard has no tile saying "unknown" about a plugin it does not run.
	 */
	const offers = {
		schema: runs(plugins, PLUGIN.schema),
		content: runs(plugins, PLUGIN.content),
		analytics: runs(plugins, PLUGIN.analytics),
		jobs: runs(plugins, PLUGIN.cron),
		logs: runs(plugins, PLUGIN.logging),
		webhooks: runs(plugins, PLUGIN.webhook),
		audit: runs(plugins, PLUGIN.audit),
	};

	const ifAdmin = <T>(offered: boolean, read: () => Promise<T>): Promise<T | null> =>
		isAdmin && stock && offered ? read().catch(() => null) : Promise.resolve(null);
	const ifStock = <T>(offered: boolean, read: () => Promise<T>): Promise<T | null> =>
		stock && offered ? read() : Promise.resolve(null);

	const count = (status: string) =>
		ifStock(offers.content, () =>
			client
				.get<ListEnvelope<RecentEntry>>(`/api/admin/content?status=${status}&limit=1&offset=0`)
				.then(statedTotal)
				.catch(() => null),
		);

	const [
		schemas,
		content,
		published,
		drafts,
		summary,
		trend,
		endpoints,
		jobs,
		volume,
		webhooks,
		deadLetters,
		audit,
		errors,
		controls,
	] = await Promise.all([
		offers.schema ? getSchemas(client).catch(() => [] as Schema[]) : Promise.resolve([] as Schema[]),
		ifStock(offers.content, () =>
			client.get<ListEnvelope<RecentEntry>>(`/api/admin/content?limit=${RECENT}&offset=0`).catch(() => null),
		),
		count('published'),
		count('draft'),
		ifAdmin(offers.analytics, () => getSummary({ from }, client)),
		ifAdmin(offers.analytics, () => getTrend({ from }, client)),
		ifAdmin(offers.analytics, () => getEndpoints({ from, limit: RECENT }, client)),
		ifAdmin(offers.jobs, () => client.get<Job[] | { jobs: Job[] }>('/api/admin/jobs')),
		ifAdmin(offers.logs, () => getLogVolume(client, window)),
		ifAdmin(offers.webhooks, () => getGlobalHealth(client)),
		// Not listDeadLetters(): its declared envelope is items and total, and
		// the engine sends data and total_count, so the list reads as empty.
		ifAdmin(offers.webhooks, () =>
			client.get<ListEnvelope<DeadLetter>>(
				`/api/admin/webhook-dead-letters?status=pending&limit=${RECENT}&offset=0`
			)
		),
		ifAdmin(offers.audit, () =>
			client.get<AuditEntry[] | ListEnvelope<AuditEntry>>(
				`/api/admin/audit-log?limit=${RECENT}&offset=0`
			)
		),
		ifAdmin(offers.logs, () =>
			client.get<LogSearchResponse>(
				`/api/admin/logs/search?level=ERROR&from=${encodeURIComponent(from)}&limit=${RECENT}`
			)
		),
		// super_admin only. An admin's 403 reads as null, and the tile that
		// would say "no failures" is not drawn from a report nobody read.
		ifAdmin(true, () => getSecurityControls(client)),
	]);

	const jobList = jobs === null ? null : Array.isArray(jobs) ? jobs : (jobs.jobs ?? []);
	// The license tile and its notices belong to the license module, so a build
	// that links none has neither. The plan is in the module's words when it
	// sends them.
	const license = hasLicenseModule(entitlements)
		? { plan: entitlements.plan_label || entitlements.plan, state: entitlements.state }
		: null;
	const data = {
		requests: summary ? requestsOf(summary) : null,
		jobs: jobList ? jobsOf(jobList) : null,
		errorsLogged: volume ? (volume.by_level?.ERROR ?? 0) : null,
		webhooks: webhooks ? webhooksOf(webhooks) : null,
		license,
		controlFailures: controls ? controls.failures : null,
	};

	// The tenant's own page, when it chose one, leads the dashboard.
	const homeSlug = customization?.entitled ? customization.settings.home_page : '';
	const homePage = homeSlug ? await getCustomPage(client, homeSlug).catch(() => null) : null;
	const homeBlocks = homePage ? await resolveBlocks(client, homePage.blocks) : [];

	return {
		schemas,
		isAdmin,
		offers,
		window,
		welcome: customization?.entitled ? customization.settings.brand.welcome : '',
		composed,
		now: now.toISOString(),
		homePage: homePage ? { slug: homePage.slug, title: homePage.title } : null,
		homeBlocks,
		entries: rowsOf(content),
		entryTotal: statedTotal(content),
		entriesByStatus: published === null || drafts === null ? null : { published, drafts },
		...data,
		attention: attentionOf(data, window),
		traffic: trend ? hoursOf(trend.points, since, now) : null,
		endpoints: endpoints ? endpoints.items.map(endpointOf) : null,
		deadLetters: rowsOf(deadLetters),
		audit: audit ? rowsOf(audit) : [],
		errors: errors?.results ?? [],
	};
};

/** The traffic tile: requests in the window, the share that failed, and p95 latency. */
function requestsOf(summary: Summary): { total: number; errorRate: number; p95: number } {
	return {
		total: summary.total_requests,
		errorRate: summary.error_rate,
		p95: summary.avg_latency_p95_ms,
	};
}

/**
 * The jobs tile: how many are enabled, and which of those last ended in an
 * error, by name, so the attention list can point at each one.
 */
function jobsOf(jobs: Job[]): { enabled: number; failed: { id: string; name: string }[] } {
	const enabled = jobs.filter((j) => j.enabled);
	return {
		enabled: enabled.length,
		failed: enabled
			.filter((j) => j.last_status === 'error')
			.map((j) => ({ id: j.id, name: j.name })),
	};
}

function endpointOf(item: BreakdownItem): TopEndpoint {
	return {
		key: item.key,
		requests: item.request_count,
		errorRate: item.error_rate,
		p95: item.avg_latency_p95_ms,
	};
}



/** The webhooks tile: unhealthy endpoints and deliveries waiting in the dead letter queue. */
function webhooksOf(health: GlobalHealthStats): { total: number; unhealthy: number; pendingDlq: number } {
	return {
		total: health.total_webhooks,
		unhealthy: health.unhealthy_webhooks,
		pendingDlq: health.pending_dlq,
	};
}

export type { DeadLetter, LogEntry };

export const actions: Actions = {
	/*
	 * Applying the pending migrations, driven by the status chip in the shell
	 * header.
	 *
	 * The chip is on every admin screen and a form action can only live on a
	 * page, so the write is hosted here: the dashboard is the one page every
	 * signed-in operator can reach, it belongs to no plugin the way the schema
	 * editor does, and it already describes what the instance is doing. Without JavaScript the browser posts here and lands here, which is
	 * where a refusal is read. With JavaScript the header reports it in place
	 * and nothing moves.
	 */
	applyMigrations: async (event) => {
		// The engine refuses this to anyone else. Checking first keeps a direct
		// post from a lower-privileged session out, and turns the refusal into a
		// 403 rather than a banner that reads like a migration failure.
		await requireRole(event, ['admin', 'super_admin']);

		const form = await event.request.formData();
		const back = localPath(form.get('redirectTo'), '/admin');

		try {
			await applyMigrations(authedClient(event));
		} catch (err) {
			// A migration that fails names the statement that failed, and that
			// sentence is the whole value of the message.
			return fail(400, { error: actionError(err, 'Migration failed') });
		}

		// Back where the reader was, with the shell's count read again on arrival.
		redirect(303, back);
	},
};
