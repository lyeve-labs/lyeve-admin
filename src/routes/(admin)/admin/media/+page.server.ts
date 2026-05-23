import type { PageServerLoad, Actions } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { createClient } from '@lyeve-labs/client';
import { authedClient, requireUser } from '$lib/server/authz';
import { actionError } from '$lib/server/action-error';
import { refusalOf, refusalText } from '$lib/api/refusal';
import { pageOf, pageWindow, pastEndOffset, withOffset, type ListEnvelope } from '$lib/api/list';
import { describeMedia, importMedia, importRefusal, parseTags, setMediaPublic, updateMediaDetails, type MediaItem, setFocalPoint, signTransformUrl, transformRequestFrom } from '$lib/api/media';
import { PLUGIN } from '$lib/plugin-names';
import { runs } from '$lib/plugins';
import { sessionToken } from '$lib/server/session-cookie';

export type { MediaItem } from '$lib/api/media';

/** The engine's own page size when a request names none. */
const DEFAULT_LIMIT = 60;

/**
 * One below the engine's list ceiling, because the request below asks for a row
 * past the page to learn whether another page exists. At the ceiling that extra
 * row would be clamped away and the last page would always look like the last
 * page.
 */
const MAX_LIMIT = 199;

/**
 * The grid renders one window of the library. A library of ten thousand files
 * is a page the browser cannot lay out, and the operator has no way to reach
 * the end of it either way.
 */
export const load: PageServerLoad = async ({ fetch, cookies, url, parent }) => {
	const token = sessionToken({ cookies, url }) ?? '';
	const client = createClient(fetch, { Authorization: `Bearer ${token}` });
	const { limit, offset } = pageWindow(url, DEFAULT_LIMIT, MAX_LIMIT);
	const q = (url.searchParams.get('q') ?? '').trim();

	// The list route has no text filter. A search goes through the engine's
	// search endpoint, which answers `items` and `total` rather than the list
	// envelope, sorted here the way the list is so the two views read alike.
	const res = q
		? await client
				.post<{ items?: MediaItem[] | null; total?: number }>('/api/admin/media/search', {
					query: q,
					limit: limit + 1,
					offset,
					sort_by: 'created_at',
					sort_desc: true,
				})
				.then((r) => ({ data: r.items ?? [], total: r.total }))
				.catch(() => null)
		: await client
				.get<ListEnvelope<MediaItem> | MediaItem[]>(
					`/api/admin/media?limit=${limit + 1}&offset=${offset}`
				)
				.catch(() => null);

	const page = pageOf<MediaItem>(res, limit, offset);
	const back = pastEndOffset(page.rows.length, limit, offset, page.total);
	if (back !== null) redirect(307, withOffset(url, back));
	// The alt-text suggestion is the AI plugin's. Without it the drawer does
	// not offer one.
	const { plugins } = await parent();
	const aiEnabled = runs(plugins, PLUGIN.ai);
	return { items: page.rows, limit, offset, total: page.total, hasMore: page.hasMore, q, aiEnabled };
};

export const actions: Actions = {
	delete: async (event) => {
		await requireUser(event);
		const { request } = event;
		const client = authedClient(event);
		const data = await request.formData();
		const id = String(data.get('id') ?? '');
		try {
			await client.delete(`/api/admin/media/${encodeURIComponent(id)}`);
		} catch (err) {
			return fail(400, { error: actionError(err, 'Failed to delete media') });
		}
	},

	update: async (event) => {
		await requireUser(event);
		const data = await event.request.formData();
		const id = String(data.get('id') ?? '');
		if (!id) return fail(400, { detailsError: 'No file was named.' });
		try {
			const item = await updateMediaDetails(authedClient(event), id, {
				alt_text: String(data.get('alt_text') ?? '').trim(),
				tags: parseTags(String(data.get('tags') ?? '')),
				folder: String(data.get('folder') ?? '').trim() || '/',
			});
			return { updated: item };
		} catch (err) {
			return fail(400, { detailsError: actionError(err, 'The details could not be saved.') });
		}
	},

	importUrl: async (event) => {
		await requireUser(event);
		const data = await event.request.formData();
		const url = String(data.get('url') ?? '').trim();
		if (!/^https?:\/\/\S+$/i.test(url)) {
			return fail(400, { importError: 'Give an http or https address.' });
		}
		try {
			const item = await importMedia(authedClient(event), {
				url,
				alt_text: String(data.get('alt_text') ?? '').trim(),
				public: data.get('public') === 'true',
			});
			return { imported: item };
		} catch (err) {
			return fail(400, { importError: importRefusal(actionError(err, 'The file could not be imported.')) });
		}
	},

	publish: async (event) => {
		await requireUser(event);
		const data = await event.request.formData();
		const id = String(data.get('id') ?? '');
		if (!id) return fail(400, { detailsError: 'No file was named.' });
		try {
			const item = await setMediaPublic(authedClient(event), id, data.get('public') === 'true');
			return { updated: item };
		} catch (err) {
			return fail(400, { detailsError: actionError(err, 'The file could not be published.') });
		}
	},

	focal: async (event) => {
		await requireUser(event);
		const data = await event.request.formData();
		const id = String(data.get('id') ?? '');
		if (!id) return fail(400, { focalError: 'No file was named.' });
		const clear = data.get('clear') === 'true';
		const x = Number(data.get('x'));
		const y = Number(data.get('y'));
		if (!clear && (!Number.isFinite(x) || !Number.isFinite(y))) {
			return fail(400, { focalError: 'Click the image to place the point.' });
		}
		try {
			const item = await setFocalPoint(authedClient(event), id, clear ? null : { x, y });
			return { updated: item, focalSaved: id };
		} catch (err) {
			return fail(400, { focalError: actionError(err, 'The focal point could not be saved.') });
		}
	},

	transformUrl: async (event) => {
		await requireUser(event);
		const data = await event.request.formData();
		const id = String(data.get('id') ?? '');
		if (!id) return fail(400, { transformError: 'No file was named.' });
		try {
			const signed = await signTransformUrl(authedClient(event), id, transformRequestFrom(data));
			return { transform: { id, url: signed.url, expires_at: signed.expires_at ?? null } };
		} catch (err) {
			const refused = refusalOf(err);
			if (refused) return fail(402, { transformError: refusalText(refused), transformRefused: refused, transformId: id });
			return fail(400, { transformError: actionError(err, 'The URL could not be built.'), transformId: id });
		}
	},

	describe: async (event) => {
		await requireUser(event);
		const id = String((await event.request.formData()).get('id') ?? '');
		if (!id) return fail(400, { detailsError: 'No file was named.' });
		try {
			return { described: { id, text: await describeMedia(authedClient(event), id) } };
		} catch (err) {
			return fail(400, { detailsError: actionError(err, 'No description came back.') });
		}
	},
};
