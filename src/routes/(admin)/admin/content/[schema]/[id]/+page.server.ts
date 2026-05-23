import type { PageServerLoad, Actions } from './$types';
import { error, fail, redirect } from '@sveltejs/kit';
import { ApiError, createClient } from '@lyeve-labs/client';
import { getSchema } from '@lyeve-labs/client-rest';
import { authedClient, requireUser, stripProtectedFields } from '$lib/server/authz';
import { actionError, actionFailure } from '$lib/server/action-error';
import { setRelations } from '$lib/server/content-relations';
import { PLUGIN } from '$lib/plugin-names';
import { runs } from '$lib/plugins';
import { listMediaChoices, type MediaChoice } from '$lib/api/media';
import { createComment, listComments, setThreadResolved, type EntryComment } from '$lib/api/content-comments';
import { addReleaseItem, editable, listReleases, type Release } from '$lib/api/content-releases';
import { rowsOf } from '$lib/api/list';
import {
	createTranslation,
	getLocales,
	listTranslations,
	translationInput,
	updateTranslation,
	type LocalePreferences,
	type Translation,
	type TranslationStatus,
} from '$lib/api/localization';
import {
	createAssignment,
	getAssignmentByEntry,
	getStageSLA,
	isTransitionAction,
	listDefinitions,
	transitionAssignment,
	type ReviewAssignment,
	type ReviewDefinition,
	type StageSLA,
} from '$lib/api/review';
import { sessionToken, type SessionRead } from '$lib/server/session-cookie';

/**
 * Entries live in the admin store (sys_content_entries) and are served by the
 * admin API. The v1 content routes read the schema engine's per-schema tables,
 * a store the admin never writes, so every load and action below targets the
 * admin endpoints and normalizes the rows into the shape the editor expects.
 */

/** Fetch the entry from the admin store and normalize it to the editor shape. */
async function getEntry(fetch: typeof globalThis.fetch, token: string, id: string) {
	const res = await fetch(`/api/admin/content/${encodeURIComponent(id)}`, {
		headers: { Authorization: `Bearer ${token}` },
	});
	if (!res.ok) return null;
	const e = await res.json();
	return {
		id: e.id,
		created_at: e.created_at,
		updated_at: e.updated_at,
		data: {
			...(e.body && typeof e.body === 'object' ? e.body : {}),
			...(e.title !== undefined ? { title: e.title } : {}),
			...(e.meta && typeof e.meta === 'object' ? e.meta : {}),
			_status: e.status ?? 'published',
		} as Record<string, unknown>,
	};
}

/** A revision in the shape the history panel renders. */
type EditorRevision = {
	id: string;
	revision_num: number;
	created_at: string;
	created_by: string;
	data: Record<string, unknown>;
};

/**
 * Normalize one revision row into the editor shape.
 *
 * A revision row carries title, body, meta and status as separate columns, the
 * same way an entry does, and the editor reads one flat `data` object. Passed
 * through unchanged, a revision reaches the panel with no `data` at all, and
 * the panel's own summary calls Object.keys on it, which throws during
 * hydration and takes the whole page down.
 */
function toEditorRevision(rev: Record<string, unknown>): EditorRevision {
	const body = rev.body;
	const meta = rev.meta;
	return {
		id: String(rev.id ?? ''),
		revision_num: Number(rev.revision_num ?? 0),
		created_at: String(rev.created_at ?? ''),
		created_by: String(rev.created_by ?? ''),
		data: {
			...(body && typeof body === 'object' ? (body as Record<string, unknown>) : {}),
			...(rev.title !== undefined ? { title: rev.title } : {}),
			...(meta && typeof meta === 'object' ? (meta as Record<string, unknown>) : {}),
			_status: rev.status ?? 'published',
		},
	};
}

/**
 * The revision list as the history panel reads it. `hiddenOlder` counts the
 * revisions the plugin left out because they are older than the window this
 * install reads, and `windowDays` is that window, null when the install reads
 * every revision.
 */
type RevisionList = { revisions: EditorRevision[]; hiddenOlder: number; windowDays: number | null };

const NO_REVISIONS: RevisionList = { revisions: [], hiddenOlder: 0, windowDays: null };

/**
 * Fetch the entry's revisions.
 *
 * The endpoint answers with the paginated envelope every admin list uses, so
 * the rows are under `data`. Handed straight through, the page would receive
 * the envelope where it expects the array: `revisions.length` would be
 * undefined, and the History control is rendered only when that is above
 * zero. Beside the page it says how many older revisions it left out.
 */
async function listRevisions(fetch: typeof globalThis.fetch, token: string, id: string): Promise<RevisionList> {
	try {
		const res = await fetch(`/api/admin/content/${encodeURIComponent(id)}/revisions`, {
			headers: { Authorization: `Bearer ${token}` },
		});
		if (!res.ok) return NO_REVISIONS;
		const body = await res.json();
		const rows = (Array.isArray(body) ? body : (body?.data ?? [])) as Record<string, unknown>[];
		const hidden = Array.isArray(body) ? 0 : Number(body?.hidden_older ?? 0);
		const days = Array.isArray(body) ? null : body?.window_days;
		return {
			revisions: rows.map(toEditorRevision),
			hiddenOlder: Number.isInteger(hidden) && hidden > 0 ? hidden : 0,
			windowDays: typeof days === 'number' && days > 0 ? days : null,
		};
	} catch {
		return NO_REVISIONS;
	}
}

/**
 * What the Translations panel renders, or null when it does not render.
 *
 * The panel exists only while the localization plugin runs: without it the
 * routes are refused and a panel over them would be a row of refusals. A
 * plugin that runs but is not answering is `unavailable`, which the panel
 * says in one line rather than hiding.
 */
export type EntryLocalization = {
	locales: LocalePreferences;
	translations: Translation[];
	unavailable: boolean;
};

async function loadLocalization(
	client: ReturnType<typeof createClient>,
	entryId: string,
	running: boolean,
): Promise<EntryLocalization | null> {
	if (!running) return null;
	try {
		const [locales, translations] = await Promise.all([
			getLocales(client),
			listTranslations(client, entryId),
		]);
		return { locales, translations, unavailable: false };
	} catch {
		return {
			locales: { default_locale: '', enabled_locales: [], fallback_chain: [] },
			translations: [],
			unavailable: true,
		};
	}
}

/**
 * What the review bar renders, or null when the review plugin does not run.
 *
 * Without it the routes are 404 and a bar over them would offer actions that
 * cannot land. The assignment read is a 404 for an entry under no review and a 403
 * for a caller the permission rules refuse, and the two are told apart: one
 * is a bar that can start a review, the other is a bar that says so.
 */
export type EntryReview = {
	assignment: ReviewAssignment | null;
	stages: StageSLA[];
	definitions: ReviewDefinition[];
	/** Approvals the current stage needs before it moves, 1 for a single approval. */
	approvalsNeeded: number;
	userId: string;
	unavailable: boolean;
	forbidden: boolean;
};

const REVIEW_NONE = (userId: string): EntryReview => ({
	assignment: null,
	stages: [],
	definitions: [],
	approvalsNeeded: 1,
	userId,
	unavailable: false,
	forbidden: false,
});

async function loadReview(
	client: ReturnType<typeof createClient>,
	entryId: string,
	running: boolean,
	user: { id: string; roles: string[] },
): Promise<EntryReview | null> {
	if (!running) return null;
	const base = REVIEW_NONE(user.id);
	// Definitions are admin-only. An assignment is started from the bar, so
	// the list is read for a caller who may start one and left empty for the
	// rest, whose bar shows the review and its actions alone.
	const canStart = user.roles.includes('admin') || user.roles.includes('super_admin');
	const definitions = canStart
		? listDefinitions(client).then((r) => r.items).catch((): ReviewDefinition[] => [])
		: Promise.resolve<ReviewDefinition[]>([]);
	try {
		// The entry's read carries the assignees, the approvals and the quorum
		// of the current stage, so the bar's counts come from one read.
		const assignment = await getAssignmentByEntry(client, entryId);
		const stages = await getStageSLA(client, assignment.id).catch((): StageSLA[] => []);
		return {
			...base,
			assignment,
			approvalsNeeded: assignment.required_approvals,
			stages,
			definitions: await definitions,
		};
	} catch (err) {
		if (err instanceof ApiError && err.status === 404) {
			return { ...base, definitions: await definitions };
		}
		if (err instanceof ApiError && err.status === 403) {
			return { ...base, forbidden: true };
		}
		return { ...base, unavailable: true };
	}
}

/**
 * The entry's editorial threads, or null when the build serves none. A read
 * that failed is said so, never drawn as an entry nobody has commented on.
 */
export type EntryComments = {
	threads: EntryComment[];
	people: { id: string; email: string }[];
	unavailable: boolean;
};

async function loadComments(client: ReturnType<typeof createClient>, entryId: string): Promise<EntryComments | null> {
	// Accounts to mention. A caller who may not list them comments without mentions.
	const people = client
		.get<{ id: string; email: string }[] | { data?: { id: string; email: string }[] }>('/api/admin/users?limit=200&offset=0')
		.then((r) => (Array.isArray(r) ? r : (r?.data ?? [])).map((u) => ({ id: u.id, email: u.email })))
		.catch(() => [] as { id: string; email: string }[]);
	try {
		const threads = await listComments(client, entryId, 'all');
		return { threads, people: await people, unavailable: false };
	} catch (err) {
		if (err instanceof ApiError && err.status === 404) return null;
		return { threads: [], people: await people, unavailable: true };
	}
}

/**
 * The releases this entry can join, and the ones it is already in. Null
 * when the build serves no releases.
 */
export type EntryReleases = {
	open: Pick<Release, 'id' | 'name' | 'status'>[];
	holding: string[];
};

async function loadReleases(client: ReturnType<typeof createClient>, entryId: string): Promise<EntryReleases | null> {
	try {
		const res = await listReleases(client, '', 100, 0);
		const open = rowsOf(res).filter(editable);
		// The list carries no items, so membership is read from each open release.
		const holding = (
			await Promise.all(
				open.map((r) =>
					client
						.get<Release>(`/api/admin/content/releases/${encodeURIComponent(r.id)}`)
						.then((full) => ((full.items ?? []).some((it) => it.entry_id === entryId) ? r.id : null))
						.catch(() => null),
				),
			)
		).filter((id): id is string => id !== null);
		return { open: open.map((r) => ({ id: r.id, name: r.name, status: r.status })), holding };
	} catch {
		return null;
	}
}

export const load: PageServerLoad = async ({ fetch, cookies, params, parent, url }) => {
	const token = sessionToken({ cookies, url }) ?? '';
	const client = createClient(fetch, { Authorization: `Bearer ${token}` });
	const { plugins, user } = await parent();

	const [schemaDef, item, revisionList, localization, review, comments, releases] = await Promise.all([
		getSchema(params.schema, client).catch(() => null),
		getEntry(fetch, token, params.id),
		listRevisions(fetch, token, params.id),
		loadLocalization(client, params.id, runs(plugins, PLUGIN.localization)),
		loadReview(client, params.id, runs(plugins, PLUGIN.review), user),
		loadComments(client, params.id).catch(() => null),
		loadReleases(client, params.id).catch(() => null),
	]);

	if (!schemaDef) {
		error(404, `Schema "${params.schema}" not found`);
	}
	if (!item) {
		error(404, 'Entry not found');
	}

	// Load relation picker items from the admin list endpoint, normalized to
	// the Content shape the picker expects.
	const relationItems: Record<string, import('@lyeve-labs/client').Content[]> = {};
	const relSchemas = [
		...new Set(
			schemaDef.fields
				.filter((f) => f.field_type === 'relation' && f.relation_to)
				.map((f) => f.relation_to as string),
		),
	];
	await Promise.all(
		relSchemas.map(async (name) => {
			const res = await fetch(
				`/api/admin/content?schema=${encodeURIComponent(name)}&limit=500&offset=0`,
				{ headers: { Authorization: `Bearer ${token}` } },
			).catch(() => null);
			const body = res && res.ok ? await res.json().catch(() => ({ data: [] })) : { data: [] };
			relationItems[name] = (body.data ?? []).map((e: { id: string; title?: string }) => ({
				id: e.id,
				schema_name: name,
				created_at: '',
				updated_at: '',
				data: { title: e.title ?? '' },
			}));
		}),
	);

	// Published library files, for a media field's picker. Read only when
	// the schema has one.
	const mediaChoices = schemaDef.fields.some((f) => f.field_type === 'media')
		? await Promise.resolve().then(() => listMediaChoices(client)).catch((): MediaChoice[] => [])
		: [];

	const { revisions, hiddenOlder, windowDays } = revisionList;
	return {
		schemaDef,
		item,
		relationItems,
		revisions,
		revisionWindow: { hiddenOlder, windowDays },
		localization,
		review,
		mediaChoices,
		comments,
		releases,
	};
};

/** The session cookie, which the relationship calls carry themselves. */
function token(event: SessionRead) {
	return sessionToken(event) ?? '';
}

export const actions: Actions = {
	// Named, not default: SvelteKit rejects a default action on a page that also
	// declares named ones.
	save: async (event) => {
		await requireUser(event);
		const { request, params } = event;
		const client = authedClient(event);
		const form = await request.formData();
		const raw = form.get('data') as string;
		const m2mRaw = form.get('m2m_relations') as string | null;

		try {
			const data = stripProtectedFields(JSON.parse(raw) as Record<string, unknown>);
			// title is written twice on purpose. It is a column on the entry, and
			// the load overlays that column on top of body, so a title only in
			// body never reads back. It is also a field of the schema, and the
			// engine validates body against that schema, so a title only in the
			// column fails the required check and the whole write is refused.
			const { title } = data;
			await client.put(`/api/admin/content/${encodeURIComponent(params.id)}`, {
				...(typeof title === 'string' ? { title } : {}),
				body: data,
			});

			if (m2mRaw) {
				const m2m = JSON.parse(m2mRaw) as Record<string, string[]>;
				await Promise.all(
					Object.entries(m2m).map(([fieldName, ids]) =>
						setRelations(event, params.id, fieldName, ids),
					),
				);
			}
		} catch (err) {
			return fail(400, { error: actionError(err, 'Failed to save entry. Check all fields and try again.') });
		}
		redirect(303, `/admin/content/${params.schema}`);
	},

	publish: async (event) => {
		await requireUser(event);
		const { params } = event;
		const client = authedClient(event);
		try {
			await client.put(`/api/admin/content/${encodeURIComponent(params.id)}`, { status: 'published' });
		} catch (err) {
			return fail(400, { error: actionError(err, 'Failed to publish entry.') });
		}
		redirect(303, `/admin/content/${params.schema}/${params.id}`);
	},

	unpublish: async (event) => {
		await requireUser(event);
		const { params } = event;
		const client = authedClient(event);
		try {
			await client.put(`/api/admin/content/${encodeURIComponent(params.id)}`, { status: 'draft' });
		} catch (err) {
			return fail(400, { error: actionError(err, 'Failed to unpublish entry.') });
		}
		redirect(303, `/admin/content/${params.schema}/${params.id}`);
	},

	/**
	 * Write one locale's translation. The panel says whether the locale
	 * already holds a row, and the plugin has one route for each case: a PUT
	 * on a locale with no row answers 404, a POST on one that exists answers
	 * a conflict. A save keeps the row's status unless the form sets one, so
	 * editing an outdated translation leaves it outdated until it is marked.
	 */
	saveTranslation: async (event) => {
		await requireUser(event);
		const { request, params } = event;
		const client = authedClient(event);
		const form = await request.formData();
		const locale = String(form.get('locale') ?? '').trim();
		const exists = form.get('exists') === 'true';
		const status = form.get('translation_status');
		if (!locale) {
			return fail(400, { error: 'Pick a locale to translate into.', translationLocale: locale });
		}
		try {
			const values = JSON.parse(String(form.get('data') ?? '{}')) as Record<string, unknown>;
			const input = {
				...translationInput(values),
				...(status === 'draft' || status === 'translated' || status === 'outdated'
					? { translation_status: status as TranslationStatus }
					: {}),
			};
			if (exists) {
				await updateTranslation(client, params.id, locale, input);
			} else {
				await createTranslation(client, params.id, locale, input);
			}
		} catch (err) {
			return fail(400, {
				error: actionError(err, 'Failed to save the translation.'),
				translationLocale: locale,
			});
		}
		redirect(303, `/admin/content/${params.schema}/${params.id}`);
	},

	/** Set one locale's translation to `translated` without touching its text. */
	markTranslated: async (event) => {
		await requireUser(event);
		const { request, params } = event;
		const client = authedClient(event);
		const form = await request.formData();
		const locale = String(form.get('locale') ?? '').trim();
		if (!locale) {
			return fail(400, { error: 'Pick a locale to mark.', translationLocale: locale });
		}
		try {
			await updateTranslation(client, params.id, locale, { translation_status: 'translated' });
		} catch (err) {
			return fail(400, {
				error: actionError(err, 'Failed to mark the translation.'),
				translationLocale: locale,
			});
		}
		redirect(303, `/admin/content/${params.schema}/${params.id}`);
	},

	/**
	 * Apply one transition to the entry's assignment. The engine's 403 is
	 * relayed with its status, so the bar can say the refusal is a permission
	 * rule or a stage role rather than a failed write. The bar offers every
	 * action the status takes and never guesses at the rules up front.
	 */
	reviewTransition: async (event) => {
		await requireUser(event);
		const { request, params } = event;
		const client = authedClient(event);
		const form = await request.formData();
		const assignmentId = String(form.get('assignment_id') ?? '').trim();
		const action = String(form.get('action') ?? '').trim();
		const comment = String(form.get('comment') ?? '').trim();
		if (!assignmentId || !isTransitionAction(action)) {
			return fail(400, { error: 'Pick an action to apply.', review: true, reviewStatus: 400 });
		}
		try {
			await transitionAssignment(client, assignmentId, action, comment);
		} catch (err) {
			const status = err instanceof ApiError ? err.status : 400;
			return fail(status === 403 ? 403 : 400, {
				error: actionError(err, 'Failed to move the review.'),
				review: true,
				reviewStatus: status,
			});
		}
		redirect(303, `/admin/content/${params.schema}/${params.id}`);
	},

	/**
	 * Start the entry through a definition. The first assignee is the
	 * primary, and the others are sent beside it, which a quorum stage needs:
	 * the plugin refuses a start that names fewer assignees than a stage's
	 * quorum, and the bar shows that refusal.
	 */
	reviewStart: async (event) => {
		await requireUser(event);
		const { request, params } = event;
		const client = authedClient(event);
		const form = await request.formData();
		const definitionId = String(form.get('definition_id') ?? '').trim();
		const assigneeId = String(form.get('assignee_id') ?? '').trim();
		if (!definitionId || !assigneeId) {
			return fail(400, { error: 'Pick a definition and an assignee.', review: true, reviewStatus: 400 });
		}
		const others = String(form.get('other_assignees') ?? '')
			.split(/[\n,]/)
			.map((s) => s.trim())
			.filter((s) => s && s !== assigneeId);
		const assigneeIds = [assigneeId, ...new Set(others)];
		try {
			await createAssignment(client, {
				entry_id: params.id,
				definition_id: definitionId,
				assignee_id: assigneeId,
				assignee_ids: assigneeIds,
			});
		} catch (err) {
			const status = err instanceof ApiError ? err.status : 400;
			return fail(status === 403 ? 403 : 400, {
				error: actionError(err, 'Failed to start the review.'),
				review: true,
				reviewStatus: status,
			});
		}
		redirect(303, `/admin/content/${params.schema}/${params.id}`);
	},

	/** Start a thread, or reply to one when the form names its first comment. */
	comment: async (event) => {
		await requireUser(event);
		const { request, params } = event;
		const form = await request.formData();
		const body = String(form.get('body') ?? '').trim();
		const parentId = String(form.get('parent_id') ?? '').trim();
		const mentions = form.getAll('mentions').map(String).filter(Boolean);
		if (!body) return fail(400, { error: 'Write the comment first.', comments: true });
		try {
			await createComment(authedClient(event), params.id, {
				body,
				mentions,
				...(parentId ? { parent_id: parentId } : {}),
			});
		} catch (err) {
			const failed = actionFailure(err, 'The comment could not be posted.');
			return fail(failed.status, { ...failed.data, comments: true });
		}
		return { commented: true };
	},

	resolveThread: async (event) => {
		await requireUser(event);
		const { request, params } = event;
		const form = await request.formData();
		const commentId = String(form.get('comment_id') ?? '').trim();
		const resolved = String(form.get('resolved') ?? '') === 'true';
		if (!commentId) return fail(400, { error: 'No thread was named.', comments: true });
		try {
			await setThreadResolved(authedClient(event), params.id, commentId, resolved);
		} catch (err) {
			const failed = actionFailure(err, 'The thread could not be updated.');
			return fail(failed.status, { ...failed.data, comments: true });
		}
		return { threadResolved: resolved };
	},

	addToRelease: async (event) => {
		await requireUser(event);
		const { request, params } = event;
		const form = await request.formData();
		const releaseId = String(form.get('release_id') ?? '').trim();
		const action = String(form.get('action') ?? '');
		if (!releaseId) return fail(400, { error: 'Pick a release.', release: true });
		if (action !== 'publish' && action !== 'unpublish') {
			return fail(400, { error: 'An entry is either published or unpublished by the release.', release: true });
		}
		try {
			await addReleaseItem(authedClient(event), releaseId, params.id, action);
		} catch (err) {
			const failed = actionFailure(err, 'The entry could not be added to the release.');
			return fail(failed.status, { ...failed.data, release: true });
		}
		return { addedToRelease: releaseId };
	},

	restore: async (event) => {
		await requireUser(event);
		const { request, params } = event;
		const client = authedClient(event);
		const data = await request.formData();
		// The rollback route names the revision by its sequence number under the
		// key `to_revision`. The row's uuid is not a number, and any other key
		// is one nothing reads, so either would refuse every restore.
		const toRevision = Number(data.get('rev_num') ?? 0);
		if (!Number.isInteger(toRevision) || toRevision <= 0) {
			return fail(400, { error: 'Pick a revision to restore.' });
		}
		try {
			await client.post(`/api/admin/content/${encodeURIComponent(params.id)}/rollback`, {
				to_revision: toRevision,
			});
		} catch (err) {
			// A revision older than the window this install reads answers 402,
			// and the history panel renders it.
			const failed = actionFailure(err, 'Failed to restore revision.');
			return fail(failed.status, { ...failed.data, revision: true });
		}
		redirect(303, `/admin/content/${params.schema}/${params.id}`);
	},

	/**
	 * Open one revision by number. The history panel offers the revision just
	 * older than the oldest it lists, and the plugin answers 402 when that one
	 * is outside the window this install reads.
	 */
	openRevision: async (event) => {
		await requireUser(event);
		const { request, params } = event;
		const form = await request.formData();
		const num = Number(form.get('rev_num') ?? 0);
		if (!Number.isInteger(num) || num <= 0) {
			return fail(400, { error: 'Pick a revision to open.', revision: true });
		}
		let raw: Record<string, unknown>;
		try {
			raw = await authedClient(event).get<Record<string, unknown>>(
				`/api/admin/content/${encodeURIComponent(params.id)}/revisions/${num}`,
			);
		} catch (err) {
			const failed = actionFailure(err, 'The revision could not be opened.');
			return fail(failed.status, { ...failed.data, revision: true });
		}
		return { openedRevision: toEditorRevision(raw) };
	},
};