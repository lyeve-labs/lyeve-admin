import type { PageServerLoad, Actions } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { getRanking, type RankingConfig } from '@lyeve-labs/client-rest';
import { authedClient, requireRole } from '$lib/server/authz';
import { actionError } from '$lib/server/action-error';
import {
	createSynonym,
	deleteSynonym,
	getPublicSchemas,
	getSearchAnalytics,
	listSchemaNames,
	listSynonymGroups,
	parseTerms,
	parseWeight,
	reindexSearch,
	searchPage,
	setDefaultRanking,
	setPublicSchemas,
	type SearchAnalytics,
	type SearchPage,
	type SynonymList,
} from '$lib/api/search-settings';
import { section, type Section } from '$lib/api/gate';
import { pageWindow, pastEndOffset, withOffset } from '$lib/api/list';

/** The results a page shows when the request names no limit. */
const RESULTS_LIMIT = 20;

/** The engine's own page ceiling, which the plugin clamps to. */
const MAX_RESULTS_LIMIT = 500;

/** Runs f so that a synchronous throw lands in the same catch as a rejection. */
const attempt = <T>(f: () => Promise<T>): Promise<T> => Promise.resolve().then(f);

export const load: PageServerLoad = async (event) => {
	const { url, parent } = event;
	const { user } = await parent();

	const client = authedClient(event);

	const q = url.searchParams.get('q')?.trim() ?? '';
	const { limit, offset } = pageWindow(url, RESULTS_LIMIT, MAX_RESULTS_LIMIT);

	// Only hit the search endpoint when a query is present. The backend
	// rejects requests with no criterion (400). A failed search is a gate, so
	// it never renders as "no results", which reads as an empty index.
	const results: Section<SearchPage> | null = q
		? await section(
				searchPage(client, q, limit, offset),
				'The search could not be run. This is not a report that nothing matched.',
			)
		: null;
	if (results?.ok) {
		const back = pastEndOffset(results.value.results.length, limit, offset, results.value.total);
		if (back !== null) redirect(307, withOffset(url, back));
	}

	// Each panel is read on its own, so one the engine refuses does not blank
	// the others. A failed read is drawn as its gate, never as empty. The
	// plugin answers its default weights when none are set, so a failed
	// ranking read is a failure and never the defaults.
	const [synonyms, ranking, publicSchemas, schemas, analytics] = await Promise.all([
		section<SynonymList>(attempt(() => listSynonymGroups(client)), 'The synonym groups could not be read. This is not a report that there are none.'),
		section<RankingConfig>(getRanking(client, '*'), 'The ranking weights could not be read, so they are not shown or offered for change.'),
		section(attempt(() => getPublicSchemas(client)), 'The public schema list could not be read.'),
		section(attempt(() => listSchemaNames(client)), 'The schemas could not be read. This is not a report that there are none.'),
		section<SearchAnalytics>(attempt(() => getSearchAnalytics(client)), 'Search analytics could not be read.'),
	]);

	return {
		results,
		synonyms,
		ranking,
		q,
		limit,
		offset,
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
			// The plugin replaces the whole row, so the boost rules are read again
			// and sent back. A save that cannot read them stops rather than
			// writing the row with none.
			const client = authedClient(event);
			const current = await getRanking(client, '*');
			await setDefaultRanking(client, { title_weight: title, body_weight: body, tag_weight: tag }, current.boost_rules ?? []);
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
			return fail(400, { synonymDeleteError: actionError(err, 'The synonym could not be deleted.') });
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
