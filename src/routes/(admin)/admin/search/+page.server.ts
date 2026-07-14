import type { PageServerLoad, Actions } from './$types';
import { fail } from '@sveltejs/kit';
import { createClient } from '@lyeve-labs/client';
import {
	search,
	listSynonyms,
	getRanking,
	type SearchResult,
	type SynonymGroup,
	type RankingConfig
} from '@lyeve-labs/client-rest';
import { authedClient, requireRole } from '$lib/server/authz';
import { actionError } from '$lib/server/action-error';
import {
	createSynonym,
	deleteSynonym,
	getPublicSchemas,
	getSearchAnalytics,
	listSchemaNames,
	parseTerms,
	parseWeight,
	reindexSearch,
	setDefaultRanking,
	setPublicSchemas,
	type SearchAnalytics,
} from '$lib/api/search-settings';
import { sessionToken } from '$lib/server/session-cookie';

const DEFAULT_RANKING: RankingConfig = {
	id: '',
	schema_name: '*',
	title_weight: 1.0,
	body_weight: 0.4,
	tag_weight: 0.2,
	boost_rules: [],
	created_at: '',
	updated_at: ''
};

/** Runs f so that a synchronous throw lands in the same catch as a rejection. */
const attempt = <T>(f: () => Promise<T>): Promise<T> => Promise.resolve().then(f);

export const load: PageServerLoad = async ({ fetch, cookies, url, parent }) => {
	const { user } = await parent();

	const token = sessionToken({ cookies, url }) ?? '';
	const client = createClient(fetch, { Authorization: `Bearer ${token}` });

	const q = url.searchParams.get('q')?.trim() ?? '';

	// Only hit the search endpoint when a query is present. The backend
	// rejects requests with no criterion (400).
	let results: SearchResult[] = [];
	let searchFailed = false;
	if (q) {
		try {
			results = (await search(q, client)).results ?? [];
		} catch {
			// A swallowed failure would render as "no results", which reads to the
			// operator as an empty index rather than an outage.
			searchFailed = true;
		}
	}

	// Each panel is read on its own, so one the engine refuses does not blank
	// the others. A null is drawn as "could not be read", never as empty.
	const [synonyms, ranking, publicSchemas, schemas, analytics] = await Promise.all([
		listSynonyms(client).catch((): SynonymGroup[] => []),
		getRanking(client, '*').catch(() => DEFAULT_RANKING),
		attempt(() => getPublicSchemas(client)).catch(() => null),
		attempt(() => listSchemaNames(client)).catch((): string[] => []),
		attempt(() => getSearchAnalytics(client)).catch((): SearchAnalytics | null => null),
	]);

	return {
		results,
		searchFailed,
		synonyms,
		ranking,
		q,
		publicSchemas,
		schemas,
		analytics,
		canReindex: user?.roles?.includes('super_admin') ?? false,
	};
};

export const actions: Actions = {
	publicSchemas: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		const form = await event.request.formData();
		const schemas = form.getAll('schemas').map(String).filter(Boolean);
		try {
			const saved = await setPublicSchemas(authedClient(event), schemas);
			return { publicSaved: saved.length };
		} catch (err) {
			return fail(400, { publicError: actionError(err, 'The public schemas could not be saved.') });
		}
	},

	ranking: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		const form = await event.request.formData();
		const title = parseWeight(form.get('title_weight'));
		const body = parseWeight(form.get('body_weight'));
		const tag = parseWeight(form.get('tag_weight'));
		if (title === null || body === null || tag === null) {
			return fail(400, { rankingError: 'Each weight is a number from 0 to 10.' });
		}
		try {
			await setDefaultRanking(authedClient(event), { title_weight: title, body_weight: body, tag_weight: tag });
			return { rankingSaved: true };
		} catch (err) {
			return fail(400, { rankingError: actionError(err, 'The weights could not be saved.') });
		}
	},

	createSynonym: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		const form = await event.request.formData();
		const baseTerm = String(form.get('base_term') ?? '').trim();
		const synonyms = parseTerms(String(form.get('synonyms') ?? ''));
		const fields: Record<string, string> = {};
		if (!baseTerm) fields.base_term = 'Required';
		if (synonyms.length === 0) fields.synonyms = 'Name at least one term';
		if (Object.keys(fields).length > 0) return fail(400, { synonymError: 'Check the highlighted fields.', fields });
		try {
			await createSynonym(authedClient(event), baseTerm, baseTerm, synonyms);
			return { synonymSaved: true };
		} catch (err) {
			return fail(400, { synonymError: actionError(err, 'The synonym could not be saved.') });
		}
	},

	deleteSynonym: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		const form = await event.request.formData();
		try {
			await deleteSynonym(authedClient(event), String(form.get('id') ?? ''));
			return { synonymDeleted: true };
		} catch (err) {
			return fail(400, { synonymError: actionError(err, 'The synonym could not be deleted.') });
		}
	},

	reindex: async (event) => {
		await requireRole(event, ['super_admin']);
		try {
			const res = await reindexSearch(authedClient(event));
			return { reindexed: res.indexed ?? 0, reindexMessage: res.message ?? '' };
		} catch (err) {
			return fail(400, { reindexError: actionError(err, 'The index could not be rebuilt.') });
		}
	},
};
