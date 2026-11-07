import type { PageServerLoad, Actions } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { getRanking, type RankingConfig } from '@lyeve-labs/client-rest';
import { authedClient, loadUser, requireRole } from '$lib/server/authz';
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
import { couldNotLoad } from '$lib/outage';

/** The results a page shows when the request names no limit. */
const RESULTS_LIMIT = 20;

/**
 * The most results the search store returns in one page. The handler lets
 * the engine's ceiling through, but the store cuts a page to 200, so a larger
 * page would hold 200 and the offsets past them would skip the rest.
 */
const MAX_RESULTS_LIMIT = 200;

/** Runs f so that a synchronous throw lands in the same catch as a rejection. */
const attempt = <T>(f: () => Promise<T>): Promise<T> => Promise.resolve().then(f);

export const load: PageServerLoad = async (event) => {
	const { url } = event;
	const user = await loadUser(event);

	const client = authedClient(event);

	const q = url.searchParams.get('q')?.trim() ?? '';
	const { limit, offset } = pageWindow(url, RESULTS_LIMIT, MAX_RESULTS_LIMIT);

	// Only hit the search endpoint when a query is present. The backend
	// rejects requests with no criterion (400). A failed search is a gate, so
	// it never renders as "no results", which reads as an empty index.
	const results: Section<SearchPage> | null = q
		? await section(
				searchPage(client, q, limit, offset),
				'Could not run the search.',
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
		section<SynonymList>(attempt(() => listSynonymGroups(client)), couldNotLoad('synonym groups')),
		section<RankingConfig>(getRanking(client, '*'), couldNotLoad('ranking weights')),
		section(attempt(() => getPublicSchemas(client)), couldNotLoad('the public schema list')),
		section(attempt(() => listSchemaNames(client)), couldNotLoad('schemas')),
		section<SearchAnalytics>(attempt(() => getSearchAnalytics(client)), couldNotLoad('search analytics')),
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
			return fail(400, { publicError: actionError(err, 'Could not save the public schemas. Try again.') });
		}
	},

	ranking: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		const form = await event.request.formData();
		const title = parseWeight(form.get('title_weight'));
		const body = parseWeight(form.get('body_weight'));
		const tag = parseWeight(form.get('tag_weight'));
		if (title === null || body === null || tag === null) {
			return fail(400, { rankingError: 'Enter a weight from 0 to 10 for each field.' });
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
			return fail(400, { rankingError: actionError(err, 'Could not save the weights. Try again.') });
		}
	},

	createSynonym: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		const form = await event.request.formData();
		const baseTerm = String(form.get('base_term') ?? '').trim();
		const synonyms = parseTerms(String(form.get('synonyms') ?? ''));
		const fields: Record<string, string> = {};
		if (!baseTerm) fields.base_term = 'Enter a base term.';
		if (synonyms.length === 0) fields.synonyms = 'Enter at least one term.';
		if (Object.keys(fields).length > 0) return fail(400, { synonymError: 'Check the highlighted fields.', fields });
		try {
			await createSynonym(authedClient(event), baseTerm, baseTerm, synonyms);
			return { synonymSaved: true };
		} catch (err) {
			return fail(400, { synonymError: actionError(err, 'Could not save the synonym. Try again.') });
		}
	},

	deleteSynonym: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		const form = await event.request.formData();
		try {
			await deleteSynonym(authedClient(event), String(form.get('id') ?? ''));
			return { synonymDeleted: true };
		} catch (err) {
			return fail(400, { synonymDeleteError: actionError(err, 'Could not delete the synonym. Try again.') });
		}
	},

	reindex: async (event) => {
		await requireRole(event, ['super_admin']);
		try {
			const res = await reindexSearch(authedClient(event));
			return { reindexed: res.indexed ?? 0, reindexMessage: res.message ?? '' };
		} catch (err) {
			return fail(400, { reindexError: actionError(err, 'Could not rebuild the index. Try again.') });
		}
	},
};
