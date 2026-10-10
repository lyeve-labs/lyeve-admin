import type { Actions, PageServerLoad } from './$types';
import { ApiError, createClient } from '@lyeve-labs/client';
import { error, fail } from '@sveltejs/kit';
import { latencyTop } from '$lib/api/observability';
import {
	byOwnerRows,
	parseAsyncHooksForm,
	parseParallelForm,
	parsePoolForm,
	putAsyncHooks,
	putParallel,
	putPoolSize,
	readGoroutineEngine,
	type AsyncHooksView,
	type GoroutineEngineViews,
	type ParallelView,
	type PoolView,
} from '$lib/api/goroutine-engine';
import { refusalOf } from '$lib/api/refusal';
import { actionError } from '$lib/server/action-error';
import { authedClient, requireRole } from '$lib/server/authz';
import { goroutineCount } from '$lib/server/goroutines';
import { sessionToken } from '$lib/server/session-cookie';

export interface PoolStatsSnapshot {
	max_open_connections: number;
	open_connections: number;
	in_use: number;
	idle: number;
	wait_count: number;
	wait_duration: number;
	max_idle_closed: number;
	max_idle_time_closed: number;
	max_lifetime_closed: number;
}

/**
 * What the engine answers at /api/admin/pool/health.
 *
 * Everything but the engine name is optional because the engine sends it that
 * way: a deployment with no pooler configured answers `healthy: true` and no
 * `pool_stats` at all, and `checked_at` can be absent with it. Declared as
 * always present, they would render empty tiles under a Healthy badge and
 * print "Invalid Date" as the time of a check that never reported one. The
 * optionality is the fact. The page reads it.
 */
export interface PoolHealth {
	engine: string;
	pool_stats?: PoolStatsSnapshot;
	latency?: number;
	healthy: boolean;
	checked_at?: string;
	errors?: string[];
	pooler_config?: string;
}

export interface LatencyStats {
	method: string;
	path: string;
	count: number;
	min_us: number;
	max_us: number;
	avg_us: number;
	p50_us: number;
	p95_us: number;
	p99_us: number;
	samples: number;
}

export interface LatencyResponse {
	tracker?: Record<string, unknown>;
	slowest: LatencyStats[];
	total: number;
}

// A request that failed carries no statistics, so it names none. A zeroed
// snapshot would read on screen as a pool with no connections open, which is
// a measurement rather than the absence of one.
const FALLBACK_POOL_HEALTH: PoolHealth = {
	healthy: false,
	engine: '',
	errors: ['Failed to fetch pool health'],
};

const FALLBACK_LATENCY: LatencyResponse = {
	slowest: [],
	total: 0,
};

/** Which of the three tunable forms an action answered for. */
export type TunableForm = 'pool' | 'parallel' | 'asyncHooks';

/**
 * The goroutine engine's panel: the views every admin may read, and whether
 * this session may write them. The writes need super_admin and a license
 * that lets tuning through, which the plugin reports as `licensed`. A form
 * that could only ever answer 403 or 402 is shown disabled with the reason,
 * rather than as a form that fails.
 */
export interface GoroutineEnginePanel extends GoroutineEngineViews {
	byOwner: ReturnType<typeof byOwnerRows>;
	superAdmin: boolean;
}

export const load: PageServerLoad = async ({ fetch, cookies, url, parent }) => {
	const { user } = await parent();
	if (!user.roles.some((r) => ['super_admin', 'admin'].includes(r))) {
		error(403, 'Requires admin or super_admin role');
	}

	const token = sessionToken({ cookies, url }) ?? '';
	const client = createClient(fetch, { Authorization: `Bearer ${token}` });

	// The row count is a query parameter, so the ranking a person is looking at
	// is a link, and refreshing the page keeps the depth they chose.
	const top = latencyTop(url.searchParams.get('top'));

	const [poolHealth, latency, views] = await Promise.all([
		client.get<PoolHealth>('/api/admin/pool/health').catch(() => FALLBACK_POOL_HEALTH),
		client
			.get<LatencyResponse>(`/api/admin/debug/latency?top=${top}`)
			.catch(() => FALLBACK_LATENCY),
		readGoroutineEngine(client),
	]);

	const goroutineEngine: GoroutineEnginePanel = {
		...views,
		byOwner: byOwnerRows(views.snapshot),
		superAdmin: user.roles.includes('super_admin'),
	};

	return { poolHealth, latency, top, goroutines: goroutineCount(views.snapshot), goroutineEngine };
};

/**
 * A refused write, as the form beside the tiles reports it. A 402 is the
 * license saying no, so it travels as the refusal every page renders the
 * same way. A 422 carries the plugin's own bounds message, which names the
 * field and the limit, so it is relayed as written. Anything else is the
 * fallback sentence.
 */
function tunableFailure(form: TunableForm, err: unknown, fallback: string) {
	const refused = refusalOf(err);
	if (refused) return fail(402, { form, refused });
	if (err instanceof ApiError && err.status === 422) {
		return fail(422, { form, error: actionError(err, fallback) });
	}
	return fail(400, { form, error: actionError(err, fallback) });
}

async function saveTunable<T>(
	form: TunableForm,
	fallback: string,
	write: () => Promise<T>,
): Promise<{ form: TunableForm; saved: true; view: T } | ReturnType<typeof tunableFailure>> {
	try {
		return { form, saved: true, view: await write() };
	} catch (err) {
		return tunableFailure(form, err, fallback);
	}
}

export const actions: Actions = {
	pool: async (event) => {
		await requireRole(event, ['super_admin']);
		const parsed = parsePoolForm(await event.request.formData());
		if ('error' in parsed) return fail(422, { form: 'pool' as const, error: parsed.error });
		return saveTunable<PoolView>('pool', 'Failed to resize the pool.', () => putPoolSize(authedClient(event), parsed.body));
	},

	parallel: async (event) => {
		await requireRole(event, ['super_admin']);
		const parsed = parseParallelForm(await event.request.formData());
		if ('error' in parsed) return fail(422, { form: 'parallel' as const, error: parsed.error });
		return saveTunable<ParallelView>('parallel', 'Failed to reconfigure the parallel engine.', () => putParallel(authedClient(event), parsed.body));
	},

	asyncHooks: async (event) => {
		await requireRole(event, ['super_admin']);
		const parsed = parseAsyncHooksForm(await event.request.formData());
		if ('error' in parsed) return fail(422, { form: 'asyncHooks' as const, error: parsed.error });
		return saveTunable<AsyncHooksView>('asyncHooks', 'Failed to reconfigure the async hooks.', () => putAsyncHooks(authedClient(event), parsed.body));
	},
};
