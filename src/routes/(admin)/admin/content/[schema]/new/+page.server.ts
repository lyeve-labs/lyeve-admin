import type { PageServerLoad, Actions } from './$types';
import { error, fail, redirect } from '@sveltejs/kit';
import { createClient, type Schema } from '@lyeve-labs/client';
import { getSchema } from '@lyeve-labs/client-rest';
import { authedClient, requireUser, stripProtectedFields } from '$lib/server/authz';
import { actionError } from '$lib/server/action-error';
import { readError } from '$lib/server/read-error';
import { setRelations } from '$lib/server/content-relations';
import { entryIdentity } from '$lib/utils/new-entry';
import { listMediaChoices, type MediaChoice } from '$lib/api/media';
import { getLocales } from '$lib/api/localization';
import { forbiddenText, section, type Section } from '$lib/api/gate';
import { PLUGIN } from '$lib/plugin-names';
import { runs } from '$lib/plugins';
import { readRelationChoices } from '$lib/components/content/relation-choices';
import { sessionToken } from '$lib/server/session-cookie';

/** One locale the new entry can be written in. */
type LocaleChoice = { code: string; name: string; is_default: boolean };

const LOCALES_FAILED = 'The locales could not be read, so no locale can be picked for this entry.';

export const load: PageServerLoad = async ({ fetch, cookies, params, url, parent }) => {
	const token = sessionToken({ cookies, url }) ?? '';
	const client = createClient(fetch, { Authorization: `Bearer ${token}` });
	const { plugins, user } = await parent();
	// The create route admits an admin and a super admin only. The schema read
	// admits any signed-in reader, so without this an editor would get a whole
	// form whose Create the engine then refuses.
	if (!user.roles.some((role) => role === 'admin' || role === 'super_admin')) {
		error(403, forbiddenText('the new entry form'));
	}

	let schemaDef: Schema;
	try {
		schemaDef = await getSchema(params.schema, client);
	} catch (err) {
		readError(err, `Schema "${params.schema}" not found`);
	}

	// The locale routes belong to the localization plugin. Without it there is
	// no locale to pick, and a read of them would only be refused. A read that
	// fails while the plugin runs is said so beside the form.
	const locales: Section<LocaleChoice[]> | null =
		schemaDef.with_localization && runs(plugins, PLUGIN.localization)
			? await section(
					getLocales(client).then((prefs) =>
						prefs.enabled_locales.map((code) => ({
							code,
							name: code,
							is_default: code === prefs.default_locale,
						})),
					),
					LOCALES_FAILED,
				)
			: null;

	// The pickers read the admin store, the one this form writes to. The
	// public content routes read a different store, so an entry made here
	// would not be in a picker fed from them.
	const relations = await readRelationChoices(fetch, token, schemaDef.fields ?? []);

	// Published library files, for a media field's picker. Read only when
	// the schema has one.
	const mediaChoices = schemaDef.fields.some((f) => f.field_type === 'media')
		? await Promise.resolve().then(() => listMediaChoices(client)).catch((): MediaChoice[] => [])
		: [];

	return { schemaDef, relations, locales, mediaChoices };
};

/**
 * Create the entry in the store the rest of the section reads.
 *
 * Content has two stores. The admin store (sys_content_entries) is what every
 * other page in this section talks to: the listing, the editor, publish,
 * rollback, revisions, translations, relationships and delete. The v1 routes
 * read the schema engine's per-schema tables, which nothing in the admin
 * writes to or reads from.
 *
 * So this action writes to the admin store. An entry created through the v1
 * route lands in a store the admin never looks at: the listing would say "No
 * entries yet" over it, and it could not be opened, edited, published or
 * deleted from the admin at all. The relations write below carries the new
 * id, so it has to name the same store.
 */
export const actions: Actions = {
	default: async (event) => {
		await requireUser(event);
		const { request, params, fetch, cookies } = event;
		const client = authedClient(event);
		const form = await request.formData();
		const raw = form.get('data') as string;
		const m2mRaw = form.get('m2m_relations') as string | null;
		try {
			const data = stripProtectedFields(JSON.parse(raw) as Record<string, unknown>);
			const schemaDef = await getSchema(params.schema, client).catch(() => null);
			const { title, slug } = entryIdentity(data, schemaDef?.fields ?? []);

			// title and slug are columns on the entry and stay in the body as
			// well. The engine validates the body against the schema, so a title
			// held only as a column fails the schema's own required check, and
			// the listing overlays the column on the body, so one held only in
			// the body never reads back. The editor writes it twice for the same
			// reason. Status is left unset: the store opens an entry as a draft,
			// and publishing is its own action with its own role check.
			const item = await client.post<{ id: string }>('/api/admin/content', {
				schema: params.schema,
				title,
				slug,
				body: data,
			});

			if (m2mRaw && item?.id) {
				const m2m = JSON.parse(m2mRaw) as Record<string, string[]>;
				await Promise.all(
					Object.entries(m2m).map(([fieldName, ids]) =>
						setRelations(event, item.id, fieldName, ids),
					),
				);
			}
		} catch (err) {
			return fail(400, { error: actionError(err, 'Failed to create entry. Check all fields and try again.') });
		}
		redirect(303, `/admin/content/${params.schema}`);
	},
};
