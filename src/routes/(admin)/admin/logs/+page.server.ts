import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { createClient } from '@lyeve-labs/client';
import {
	getLoggingLevels,
	getLoggingConfig,
	getLogVolume,
	type LogSearchResponse
} from '@lyeve-labs/client-rest';
import { pageWindow, pastEndOffset, withOffset } from '$lib/api/list';
import { LOG_DEFAULT_LIMIT, LOG_MAX_LIMIT } from '$lib/api/logs';
import { sessionToken } from '$lib/server/session-cookie';

export const load: PageServerLoad = async ({ fetch, cookies, url, parent }) => {
	await parent();

	const token = sessionToken({ cookies, url }) ?? '';
	const client = createClient(fetch, { Authorization: `Bearer ${token}` });

	const q = url.searchParams.get('q') ?? '';
	const level = url.searchParams.get('level') ?? '';
	const { limit, offset } = pageWindow(url, LOG_DEFAULT_LIMIT, LOG_MAX_LIMIT);

	// Built here rather than through searchLogs(), which sends no offset.
	const qs = new URLSearchParams({ limit: String(limit), offset: String(offset) });
	if (q) qs.set('query', q);
	if (level) qs.set('level', level);

	const [search, levels, config, volume] = await Promise.all([
		client.get<LogSearchResponse>(`/api/admin/logs/search?${qs}`).catch(() => null),
		getLoggingLevels(client).catch(() => null),
		getLoggingConfig(client).catch(() => null),
		getLogVolume(client, '24h').catch(() => null)
	]);

	// The stated count is trusted as it is. Raising it to offset plus rows read,
	// as the audit log does, turns an offset past the end into the total, and
	// the correction below then walks back one page per redirect until the
	// browser gives up.
	const entries = search?.results ?? [];
	const total = search?.total ?? null;
	const back = pastEndOffset(entries.length, limit, offset, total);
	if (back !== null) redirect(307, withOffset(url, back));

	return {
		entries,
		total,
		limit,
		offset,
		levels,
		config,
		volume,
		q,
		level
	};
};
