import type { PageServerLoad, Actions } from './$types';
import { fail } from '@sveltejs/kit';
import { authedClient, requireRole } from '$lib/server/authz';
import { actionError } from '$lib/server/action-error';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning } from '$lib/plugins';
import { section, type Section } from '$lib/api/gate';
import {
	RECOMMENDATIONS_OK,
	generateFeed,
	isAlreadyRunning,
	isUserId,
	readAbStats,
	recommendationsGate,
	refreshAll,
	type AbStats,
	type RecommendationsGate,
	readTrending,
	type TrendingItem,
} from '$lib/api/recommendations';

/** An account the preview can run for. */
interface Reader {
	id: string;
	email: string;
}

export const load: PageServerLoad = async (event) => {
	const { plugins, user } = await event.parent();
	// Reading the split takes an admin. The recompute and the per-user feed
	// are super admin, so the page says which half is available.
	const canRecompute = user.roles.includes('super_admin');

	// The shell says why the page is unavailable while its plugin does not run.
	if (notRunning(plugins, PLUGIN.recommendations)) {
		return {
			stats: null as AbStats | null,
			gate: { state: 'absent' } as RecommendationsGate,
			canRecompute,
			trending: { ok: false, gate: { state: 'absent' } } as Section<TrendingItem[]>,
			readers: { ok: true, value: [] } as Section<Reader[]>,
		};
	}

	const client = authedClient(event);
	// The trending list is read beside the split: a list the reader cannot
	// see is no reason to hide the split, and the reverse.
	const trending = await section(
		readTrending(client),
		'The trending list could not be read. This is not a report that nothing is trending.',
	);

	/*
	 * The accounts the preview can be run for.
	 *
	 * Offering accounts by name spares the operator a trip to another page to
	 * copy a UUID. The engine answers with a bare array and no total, so this is
	 * the first page of accounts rather than all of them, and the field still
	 * accepts a typed id for an account past it.
	 *
	 * Only for the role that may run the preview. An admin who cannot generate a
	 * feed has no reason to be handed a roster of accounts.
	 */
	const readers: Section<Reader[]> = canRecompute
		? await section(
				client
					.get<Reader[]>('/api/admin/users?limit=200')
					.then((rows) => (Array.isArray(rows) ? rows : [])),
				'The accounts could not be read, so give the user id as it appears on the Users page.',
			)
		: { ok: true, value: [] };
	try {
		return {
			stats: await readAbStats(client),
			gate: RECOMMENDATIONS_OK,
			canRecompute,
			trending,
			readers,
		};
	} catch (err) {
		return {
			stats: null,
			gate: recommendationsGate(err),
			canRecompute,
			trending,
			readers,
		};
	}
};

export const actions: Actions = {
	// A 409 here means somebody else pressed the button first. Reporting it as
	// a failure sends an operator looking for a fault that is not there, so it
	// is answered as its own outcome.
	refresh: async (event) => {
		await requireRole(event, ['super_admin']);
		const client = authedClient(event);
		try {
			const result = await refreshAll(client);
			return {
				refreshed: true,
				pairs: result.similarity_pairs_computed,
				trending: result.trending_items_computed,
				feeds: result.feeds_generated,
				ms: result.duration_ms,
			};
		} catch (err) {
			if (isAlreadyRunning(err)) {
				return fail(409, {
					action: 'refresh',
					error: 'A recompute is already running. Wait for it rather than starting a second.',
				});
			}
			return fail(400, { action: 'refresh', error: actionError(err, 'The recompute could not be started.') });
		}
	},

	preview: async (event) => {
		await requireRole(event, ['super_admin']);
		const client = authedClient(event);
		const form = await event.request.formData();
		const userId = String(form.get('user_id') ?? '').trim();
		if (!userId) return fail(400, { action: 'preview', error: 'Name the user whose feed you want to see.' });
		if (!isUserId(userId)) {
			return fail(400, { action: 'preview', error: 'That is not a user id. Pick a reader by email, or paste the id from the Users page.' });
		}
		try {
			const entries = await generateFeed(client, userId);
			return { previewFor: userId, feed: entries ?? [] };
		} catch (err) {
			return fail(400, { action: 'preview', error: actionError(err, 'That feed could not be generated.') });
		}
	},
};
