/**
 * Every route the instance serves, as the rate limit's endpoint patterns
 * spell them, read from the engine's own OpenAPI document. The document holds
 * the engine's routes, every running plugin's (realtime and its stream,
 * GraphQL, the broker's status) and the URLs the tenant's flows answer, so a
 * route added by a plugin or a flow can be picked the moment it exists.
 */
import type { OpenAPIDocument } from './openapi';

export interface RouteOption {
	value: string;
	label: string;
	keywords?: string[];
}

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

export function routeOptions(doc: OpenAPIDocument | null): RouteOption[] {
	const out: RouteOption[] = [{ value: '*', label: '* (every request)' }];
	if (!doc?.paths) return out;
	const seen = new Set<string>(['*']);
	for (const path of Object.keys(doc.paths).sort()) {
		const ops = doc.paths[path] ?? {};
		for (const m of METHODS) {
			const op = ops[m];
			if (!op) continue;
			const value = `${m.toUpperCase()} ${path}`;
			if (seen.has(value)) continue;
			seen.add(value);
			const keywords = [op.summary, ...(op.tags ?? [])].filter((k): k is string => !!k);
			out.push({ value, label: value, keywords });
		}
	}
	return out;
}

/** The route options as the caller may see them, or the catch-all alone. */
export async function readRouteOptions(client: { get<T>(path: string): Promise<T> }): Promise<RouteOption[]> {
	const doc = await Promise.resolve()
		.then(() => client.get<OpenAPIDocument>('/api/admin/openapi.json'))
		.catch(() => null);
	return routeOptions(doc);
}
