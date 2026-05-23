/**
 * What the search plugin is set to do for this tenant: which schemas anyone
 * may search, how fields weigh against each other, which terms stand for
 * others, and what people have been searching for.
 */
import type { HttpClient } from '@lyeve-labs/client';

export interface SearchAnalytics {
	total_searches: number;
	unique_queries: number;
	avg_result_count: number;
	avg_duration_ms: number;
	zero_result_pct: number;
	top_queries: { query_text: string; count: number }[];
}

export interface RankingWeights {
	title_weight: number;
	body_weight: number;
	tag_weight: number;
}

export function getPublicSchemas(client: HttpClient): Promise<string[]> {
	return client.get<{ schemas: string[] }>('/api/admin/search/public-schemas').then((r) => r.schemas ?? []);
}

export function setPublicSchemas(client: HttpClient, schemas: string[]): Promise<string[]> {
	return client.put<{ schemas: string[] }>('/api/admin/search/public-schemas', { schemas }).then((r) => r.schemas ?? []);
}

export function getSearchAnalytics(client: HttpClient): Promise<SearchAnalytics> {
	return client.get<SearchAnalytics>('/api/admin/search/analytics');
}

/** Weights for every schema that has no row of its own. */
export function setDefaultRanking(client: HttpClient, w: RankingWeights): Promise<unknown> {
	return client.put('/api/admin/search/ranking', { schema_name: '*', ...w });
}

export function createSynonym(client: HttpClient, name: string, baseTerm: string, synonyms: string[]): Promise<unknown> {
	return client.post('/api/admin/search/synonyms', { name, base_term: baseTerm, synonyms });
}

export function deleteSynonym(client: HttpClient, id: string): Promise<unknown> {
	return client.delete(`/api/admin/search/synonyms/${encodeURIComponent(id)}`);
}

export function reindexSearch(client: HttpClient): Promise<{ indexed: number; message: string }> {
	return client.post('/api/admin/search/reindex', {});
}

/** Schema names from the engine's schema list, sorted. */
export async function listSchemaNames(client: HttpClient): Promise<string[]> {
	const rows = await client.get<{ name: string }[] | { data: { name: string }[] }>('/api/admin/schemas');
	const list = Array.isArray(rows) ? rows : (rows.data ?? []);
	return list.map((s) => s.name).filter(Boolean).sort();
}

/** Terms from a comma list: trimmed, empty ones dropped, each once. */
export function parseTerms(raw: string): string[] {
	const out: string[] = [];
	for (const part of raw.split(',')) {
		const t = part.trim();
		if (t && !out.includes(t)) out.push(t);
	}
	return out;
}

/** A weight from a form field, or null when it is not a number from 0 to 10. */
export function parseWeight(raw: FormDataEntryValue | null): number | null {
	const n = Number(String(raw ?? '').trim());
	if (String(raw ?? '').trim() === '' || !Number.isFinite(n) || n < 0 || n > 10) return null;
	return n;
}
