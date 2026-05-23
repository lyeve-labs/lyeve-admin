import type { PageServerLoad, Actions } from './$types';
import { error, fail, redirect } from '@sveltejs/kit';
import { createClient } from '@lyeve-labs/client';
import { getSchema, listContent } from '@lyeve-labs/client-rest';
import { authedClient, requireUser, stripProtectedFields } from '$lib/server/authz';
import { actionError } from '$lib/server/action-error';
import { setRelations } from '$lib/server/content-relations';
import { entryIdentity } from '$lib/utils/new-entry';
import { listMediaChoices, type MediaChoice } from '$lib/api/media';
import { sessionToken } from '$lib/server/session-cookie';

export const load: PageServerLoad = async ({ fetch, cookies, params, url }) => {
	const token = sessionToken({ cookies, url }) ?? '';
	const client = createClient(fetch, { Authorization: `Bearer ${token}` });

	const schemaDef = await getSchema(params.schema, client).catch(() => null);
	if (!schemaDef) {
		error(404, `Schema "${params.schema}" not found`);
	}

	// Load available locales if schema supports localization
	let locales: { code: string; name: string; is_default: boolean }[] = [];
	if (schemaDef.with_localization) {
		const prefs = await client.get<{ default_locale: string; enabled_locales: string[] }>(
			'/api/admin/localization/locales'
		);
		locales = prefs.enabled_locales.map((code) => ({
			code,
			name: code,
			is_default: code === prefs.default_locale,
		}));
	}

	// Load relation picker items
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
			relationItems[name] = await listContent(name, client, 500, 0).catch(() => []);
		}),
	);

	// Published library files, for a media field's picker. Read only when
	// the schema has one.
	const mediaChoices = schemaDef.fields.some((f) => f.field_type === 'media')
		? await Promise.resolve().then(() => listMediaChoices(client)).catch((): MediaChoice[] => [])
		: [];

	return { schemaDef, relationItems, locales, mediaChoices };
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
