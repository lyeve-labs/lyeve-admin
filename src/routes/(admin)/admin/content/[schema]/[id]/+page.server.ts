import type { PageServerLoad, Actions } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { ApiError, type Schema, type HttpClient } from '@lyeve-labs/client';
import { getSchema } from '@lyeve-labs/client-rest';
import { authedClient, requireUser, stripProtectedFields } from '$lib/server/authz';
import { actionError, actionFailure } from '$lib/server/action-error';
import { readError } from '$lib/server/read-error';
import { refusalOf, refusalText } from '$lib/api/refusal';
import { readRelationChoices } from '$lib/server/relation-choices';
import { setEntryRelations } from '$lib/server/content-relations';
import { fieldRefusalOf } from '$lib/server/content-validation';
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
import { listPeople, type Person } from '$lib/server/people';

/**
 * Entries live in the admin store (sys_content_entries) and are served by the
 * admin API. The v1 content routes read the schema engine's per-schema tables,
 * a store the admin never writes, so every load and action below targets the
 * admin endpoints and normalizes the rows into the shape the editor expects.
 */

/** An entry as the admin store answers it. */
type StoredEntry = {
	id: string;
	created_at: string;
	updated_at: string;
	title?: unknown;
	body?: unknown;
	meta?: unknown;
	status?: string;
};

/**
 * Fetch the entry from the admin store and normalize it to the editor shape.
 * A refusal throws the client's error, so the load can tell an entry that is
 * not there from an engine that did not answer.
 */
async function getEntry(client: HttpClient, id: string) {
	const e = await client.get<StoredEntry>(`/api/admin/content/${encodeURIComponent(id)}`);
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
type RevisionList = {
	revisions: EditorRevision[];
	hiddenOlder: number;
	windowDays: number | null;
	/** How many revisions the plugin says the entry has in the window, which can exceed the rows read. */
	total: number;
	/** The read failed, so the empty list says nothing about the entry's history. */
	failed: boolean;
	/**
	 * Whether the entry's type keeps history. Null when the plugin did not
	 * say, which an engine older than the setting never does.
	 */
	historyEnabled: boolean | null;
};

const REVISIONS_FAILED: RevisionList = {
	revisions: [],
	hiddenOlder: 0,
	windowDays: null,
	total: 0,
	failed: true,
	historyEnabled: null,
};

/**
 * Fetch the entry's revisions.
 *
 * The endpoint answers with the paginated envelope every admin list uses, so
 * the rows are under `data`. Handed straight through, the page would receive
 * the envelope where it expects the array: `revisions.length` would be
 * undefined, and the History control is rendered only when that is above
 * zero. Beside the page it says how many older revisions it left out.
 */
/** The revisions as the endpoint answers them: the envelope, or a bare array from an older engine. */
type RevisionBody =
	| Record<string, unknown>[]
	| {
			data?: Record<string, unknown>[];
			total_count?: unknown;
			hidden_older?: unknown;
			window_days?: unknown;
			history_enabled?: unknown;
	  }
	| null;

/**
 * The most rows one read asks for, which is the engine's page ceiling. Left
 * unnamed, the plugin answers its default of 50, newest first, and the older
 * ones could not be listed or restored from the panel.
 */
const REVISION_LIMIT = 500;

async function listRevisions(client: HttpClient, id: string): Promise<RevisionList> {
	try {
		const body = await client.get<RevisionBody>(
			`/api/admin/content/${encodeURIComponent(id)}/revisions?limit=${REVISION_LIMIT}&offset=0`,
		);
		const rows = (Array.isArray(body) ? body : (body?.data ?? [])) as Record<string, unknown>[];
		const hidden = Array.isArray(body) ? 0 : Number(body?.hidden_older ?? 0);
		const days = Array.isArray(body) ? null : body?.window_days;
		const counted = Array.isArray(body) ? NaN : Number(body?.total_count);
		const enabled = Array.isArray(body) ? undefined : body?.history_enabled;
		return {
			revisions: rows.map(toEditorRevision),
			total: Number.isInteger(counted) && counted > rows.length ? counted : rows.length,
			hiddenOlder: Number.isInteger(hidden) && hidden > 0 ? hidden : 0,
			windowDays: typeof days === 'number' && days > 0 ? days : null,
			failed: false,
			historyEnabled: typeof enabled === 'boolean' ? enabled : null,
		};
	} catch {
		return REVISIONS_FAILED;
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
	client: HttpClient,
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
	/** The accounts a review can be handed to. Empty for a caller who may not list them. */
	people: Person[];
	unavailable: boolean;
	forbidden: boolean;
	/** The definitions read failed, so the bar cannot offer to start a review. */
	definitionsFailed: boolean;
};

const REVIEW_NONE = (userId: string): EntryReview => ({
	assignment: null,
	stages: [],
	definitions: [],
	approvalsNeeded: 1,
	userId,
	people: [],
	unavailable: false,
	forbidden: false,
	definitionsFailed: false,
});

async function loadReview(
	client: HttpClient,
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
		? listDefinitions(client).then(
				(r) => ({ items: r.items, failed: false }),
				() => ({ items: [] as ReviewDefinition[], failed: true }),
			)
		: Promise.resolve({ items: [] as ReviewDefinition[], failed: false });
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
			definitions: (await definitions).items,
		};
	} catch (err) {
		if (err instanceof ApiError && err.status === 404) {
			const read = await definitions;
			return { ...base, definitions: read.items, definitionsFailed: read.failed };
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

async function loadComments(
	client: HttpClient,
	entryId: string,
	people: Promise<Person[]>,
): Promise<EntryComments | null> {
	// Accounts to mention. A caller who may not list them comments without mentions.
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
	/** The releases could not be read, so the card offers none. */
	failed: boolean;
};

async function loadReleases(client: HttpClient, entryId: string): Promise<EntryReleases | null> {
	try {
		const res = await listReleases(client, '', 100, 0);
		const open = rowsOf(res).filter(editable);
		// The list carries no items, so membership is read from each open
		// release. A release whose items could not be read is not one that
		// leaves the entry out, so one failed read leaves the card unread.
		const reads = await Promise.all(
			open.map((r) =>
				client
					.get<Release>(`/api/admin/content/releases/${encodeURIComponent(r.id)}`)
					.then((full) => ((full.items ?? []).some((it) => it.entry_id === entryId) ? r.id : null))
					.catch(() => undefined),
			),
		);
		if (reads.includes(undefined)) return { open: [], holding: [], failed: true };
		const holding = reads.filter((id): id is string => typeof id === 'string');
		return { open: open.map((r) => ({ id: r.id, name: r.name, status: r.status })), holding, failed: false };
	} catch (err) {
		if (err instanceof ApiError && err.status === 404) return null;
		return { open: [], holding: [], failed: true };
	}
}

export const load: PageServerLoad = async (event) => {
	const { params, parent } = event;
	const client = authedClient(event);
	const { plugins, user } = await parent();
	// One read of the directory serves the mention list and the review picker.
	const people = listPeople(client);

	const [schemaDef, item, revisionList, localization, review, comments, releases] = await Promise.all([
		getSchema(params.schema, client).catch((err: unknown): Schema => readError(err, `Schema "${params.schema}" not found`)),
		getEntry(client, params.id).catch((err: unknown) => readError(err, 'Entry not found')),
		listRevisions(client, params.id),
		loadLocalization(client, params.id, runs(plugins, PLUGIN.localization)),
		loadReview(client, params.id, runs(plugins, PLUGIN.review), user).then(async (r) =>
			r ? { ...r, people: await people } : null,
		),
		loadComments(client, params.id, people).catch(() => null),
		loadReleases(client, params.id).catch(() => null),
	]);

	const relations = await readRelationChoices(client, schemaDef.fields ?? []);

	// Published library files, for a media field's picker. Read only when
	// the schema has one. A read that fails is null, so the picker says the
	// library could not be read instead of claiming nothing is published.
	const mediaChoices: MediaChoice[] | null = schemaDef.fields.some((f) => f.field_type === 'media')
		? await Promise.resolve().then(() => listMediaChoices(client)).catch(() => null)
		: [];

	const { revisions, hiddenOlder, windowDays, total: revisionTotal, failed: revisionsFailed, historyEnabled } =
		revisionList;
	return {
		schemaDef,
		item,
		relations,
		revisions,
		revisionTotal,
		revisionsFailed,
		revisionWindow: { hiddenOlder, windowDays },
		historyEnabled,
		// The history settings take an admin, so only an admin is pointed there.
		canManageHistory: (user?.roles ?? []).some((role) => role === 'admin' || role === 'super_admin'),
		localization,
		review,
		mediaChoices,
		comments,
		releases,
	};
};

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

		let links: Record<string, string[]> | null = null;
		try {
			const data = stripProtectedFields(JSON.parse(raw) as Record<string, unknown>);
			links = m2mRaw ? (JSON.parse(m2mRaw) as Record<string, string[]>) : null;
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
		} catch (err) {
			// The fields the form shows are the schema's own, so a refusal names
			// them against the schema rather than against what the form sent.
			if (err instanceof ApiError && err.status === 422) {
				const schemaDef = await getSchema(params.schema, client).catch(() => null);
				const shown = (schemaDef?.fields ?? []).filter((f) => !f.system).map((f) => f.name);
				const refused = fieldRefusalOf(err, shown);
				if (refused) return fail(422, refused);
			}
			return fail(400, { error: actionError(err, 'Failed to save entry. Check all fields and try again.') });
		}

		// The entry is saved by now, so a refused link is reported as such
		// rather than as a failed save or a finished one.
		if (links) {
			const failed = await setEntryRelations(event, params.id, links);
			if (failed) return fail(400, { error: `The entry was saved, but not every link was. ${failed}` });
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
				// The localization plugin refuses a new translation with no title,
				// so a title left empty saves the source title as it is now. The
				// panel says so beside the empty box.
				if (!input.title?.trim()) {
					const source = await client.get<{ title?: string }>(`/api/admin/content/${encodeURIComponent(params.id)}`);
					if (source?.title) input.title = source.title;
				}
				await createTranslation(client, params.id, locale, input);
			}
		} catch (err) {
			// A 402 is the locale ceiling or a license refusal, which carries
			// numbers and a link a bare relayed code would drop.
			const refused = refusalOf(err);
			if (refused) return fail(402, { error: refusalText(refused), refused, translationLocale: locale });
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
		// The picker posts one field per account and the typed fallback one
		// field of ids, by line or by comma. Both read the same way.
		const others = form
			.getAll('other_assignees')
			.flatMap((v) => String(v).split(/[\n,]/))
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