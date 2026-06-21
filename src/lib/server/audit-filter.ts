/**
 * The audit log's filter, as the page carries it and as the engine takes it.
 * Lives beside the load rather than in it: a page module may export nothing
 * but what SvelteKit names, and a helper exported from one is a 500 in the
 * browser that every unit test passes.
 */
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The filter the page carries in its address. Every link on the page keeps it. */
export interface AuditFilter {
	q: string;
	action: string;
	from: string;
	to: string;
}

export function readFilter(url: URL): AuditFilter {
	const day = (key: string) => {
		const v = url.searchParams.get(key) ?? '';
		return DAY.test(v) ? v : '';
	};
	return {
		q: (url.searchParams.get('q') ?? '').trim(),
		action: (url.searchParams.get('action') ?? '').trim(),
		from: day('from'),
		to: day('to'),
	};
}

/**
 * The endpoint's own filters for one search box.
 *
 * The engine matches exactly and takes no free text: `actor` is a user id,
 * `action` is the namespaced name (`content.delete`) and `resource_type` is
 * the bare type. One box has to pick the column by the shape of what was
 * typed: an id goes to the actor, a dotted name to the action, and anything
 * else to the resource type. The action select wins over a dotted search,
 * because both name the same column.
 */
export function endpointQuery(filter: AuditFilter, limit: number, offset: number): URLSearchParams {
	const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
	if (filter.action) params.set('action', filter.action);
	if (filter.q) {
		if (UUID.test(filter.q)) params.set('actor', filter.q);
		else if (filter.q.includes('.') && !filter.action) params.set('action', filter.q);
		else params.set('resource_type', filter.q);
	}
	// `to` is exclusive on the engine, so the chosen day is kept whole by
	// asking for everything before the next one.
	if (filter.from) params.set('from', `${filter.from}T00:00:00Z`);
	if (filter.to) {
		const next = new Date(`${filter.to}T00:00:00Z`);
		next.setUTCDate(next.getUTCDate() + 1);
		params.set('to', next.toISOString().slice(0, 10) + 'T00:00:00Z');
	}
	return params;
}

