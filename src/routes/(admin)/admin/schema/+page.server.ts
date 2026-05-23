import type { Actions, PageServerLoad } from './$types';
import { fail } from '@sveltejs/kit';
import { ApiError, createClient, type Schema } from '@lyeve-labs/client';
import { getSchemas, getSchemaStats } from '@lyeve-labs/client-rest';
import { authedClient, requireRole, requireUser } from '$lib/server/authz';
import { actionError } from '$lib/server/action-error';
import { retryBusy } from '$lib/server/retry-busy';
import { bundleContentType, flowAuthHeaders, readImportForm } from '$lib/server/flow-import';
import { IMPORT_SOURCES } from './import-sources';
import { applySchemaPreset, deleteSchemaPreset, readSchemaPresets, saveSchemaPreset, type SchemaPreset } from '$lib/api/schema-preset-catalog';
import { NO_CANVAS, parsePositions, readCanvasLayout, saveCanvasLayout, type CanvasLayout } from '$lib/api/schema-canvas-layout';
import { refusalOf, refusalText } from '$lib/api/refusal';
import { sessionToken } from '$lib/server/session-cookie';

/** Every schema write the engine serves takes one of these. */
const WRITERS = ['admin', 'super_admin'];

export type DryRunStatement = { description: string; sql: string; down_sql?: string };

/** One statement the engine recorded for a table, as GET .../history answers it. */
export type HistoryEntry = {
	version: number;
	description: string;
	up_sql: string;
	down_sql?: string;
	state: 'applied' | 'pending' | 'failed' | 'canceled';
	applied_at?: string;
	applied_by?: string;
	/** The tenant whose save wrote the entry. Absent when the engine does not record it. */
	tenant?: string;
	canceled_at?: string;
	created_at: string;
};

/** The import plan the engine answers before anything is applied. */
export type ImportPlan = {
	schemas: { name: string; action: 'create' | 'update' | 'unchanged'; ddl?: string[]; dependencies?: string[]; missing?: string[] }[];
	second_pass?: string[];
};


/**
 * How many stats calls run at once. One per schema all together would open as
 * many requests as a tenant has schemas before the page could paint.
 */
const STATS_CONCURRENCY = 8;

async function countRows(schemas: Schema[], client: ReturnType<typeof createClient>): Promise<Record<string, number>> {
	const out: Record<string, number> = {};
	let next = 0;
	async function worker() {
		while (next < schemas.length) {
			const s = schemas[next++];
			try {
				out[s.name] = (await getSchemaStats(s.name, client)).rows;
			} catch {
				// A count that could not be read is left out rather than shown as 0.
			}
		}
	}
	await Promise.all(Array.from({ length: Math.min(STATS_CONCURRENCY, schemas.length) }, worker));
	return out;
}

export const load: PageServerLoad = async ({ fetch, cookies, parent, url }) => {
	const { user } = await parent();
	const token = sessionToken({ cookies, url }) ?? '';
	const client = createClient(fetch, { Authorization: `Bearer ${token}` });
	const canWrite = (user?.roles ?? []).some((r: string) => WRITERS.includes(r));
	const isSuperAdmin = (user?.roles ?? []).includes('super_admin');

	// A failed read is said as one, not drawn as an instance with no schemas:
	// the empty state offers to create the first one, and a table the engine
	// could not list is not a table that is not there.
	let schemas: Schema[];
	try {
		schemas = await getSchemas(client);
	} catch {
		return {
			schemas: [] as Schema[],
			rowCounts: Promise.resolve({} as Record<string, number>),
			presets: [] as SchemaPreset[],
			presetsError: null,
			canSavePresets: false,
			canvas: NO_CANVAS as CanvasLayout,
			canWrite,
			isSuperAdmin,
			loadError: true,
		};
	}

	// The presets are an offer, not the page: an install that has none, or
	// cannot list them, still edits the schemas it has. The refusal is kept so
	// the picker can say why it is empty rather than claim there are none.
	let presets: SchemaPreset[] = [];
	let presetsError: string | null = null;
	let canSavePresets = false;
	try {
		({ presets, canSave: canSavePresets } = await readSchemaPresets(client));
	} catch (err) {
		presetsError = err instanceof ApiError && err.status === 404 ? null : 'The presets could not be loaded.';
	}

	// Streamed: the list paints with the definitions, and the counts arrive
	// after it. Nothing on the page waits on them but the row figures.
	const rowCounts = countRows(schemas, client);

	// The plugin says whether this install draws the canvas, with the layout
	// it saved. A read that fails draws none, which is what an install without
	// the capability sees, and the list editor still does everything.
	const canvas = await readCanvasLayout(client).catch(() => NO_CANVAS);

	return { schemas, rowCounts, presets, presetsError, canSavePresets, canvas, canWrite, isSuperAdmin, loadError: false };
};

function parseSchema(raw: FormDataEntryValue | null): Schema | null {
	try {
		const s = JSON.parse(String(raw ?? '')) as Schema;
		return s && typeof s.name === 'string' && Array.isArray(s.fields) ? s : null;
	} catch {
		return null;
	}
}

function parseRenames(raw: FormDataEntryValue | null): { from: string; to: string }[] {
	try {
		const list = JSON.parse(String(raw ?? '[]')) as unknown;
		if (!Array.isArray(list)) return [];
		return list.filter(
			(r): r is { from: string; to: string } =>
				!!r && typeof r.from === 'string' && typeof r.to === 'string' && r.from !== '' && r.to !== '' && r.from !== r.to,
		);
	} catch {
		return [];
	}
}

/** The status to answer a failed write with: the engine's, when it is a refusal of the request. */
const statusOf = (err: unknown) => (err instanceof ApiError && err.status >= 400 && err.status < 600 ? err.status : 400);

const path = (...parts: string[]) => parts.map(encodeURIComponent).join('/');

export const actions: Actions = {
	/**
	 * Saves one schema. Renamed fields go through the engine's rename route
	 * first, because the definition alone is diffed by name and a renamed field
	 * would otherwise land as a new column beside a dropped one.
	 */
	save: async (event) => {
		await requireRole(event, WRITERS);
		const data = await event.request.formData();
		const schema = parseSchema(data.get('schema'));
		if (!schema) return fail(400, { scope: 'save' as const, error: 'The schema could not be read.' });
		const original = String(data.get('original') ?? '');
		if (original && original !== schema.name) {
			return fail(400, { scope: 'save' as const, error: 'A saved schema is renamed with Rename, not by editing its machine name.' });
		}
		const client = authedClient(event);

		const renamed: { from: string; to: string }[] = [];
		const said = () => renamed.map((r) => `${r.from} to ${r.to}`).join(', ');
		if (original) {
			for (const r of parseRenames(data.get('renames'))) {
				try {
					await retryBusy(() =>
						client.put(`/api/admin/schemas/${path(original, 'fields', r.from, 'rename')}`, { new_name: r.to }),
					);
					renamed.push(r);
				} catch (err) {
					const done = renamed.length ? ` Already renamed: ${said()}.` : '';
					return fail(statusOf(err), {
						scope: 'save' as const,
						error: `${actionError(err, `The field ${r.from} could not be renamed.`)}${done}`,
						renamed,
					});
				}
			}
		}

		try {
			const saved = await retryBusy(() => client.post<Schema>('/api/admin/schemas', schema));
			return { scope: 'save' as const, saved };
		} catch (err) {
			const done = renamed.length ? ` The renames went through: ${said()}.` : '';
			return fail(statusOf(err), {
				scope: 'save' as const,
				error: `${actionError(err, 'The schema could not be saved.')}${done}`,
				renamed,
			});
		}
	},

	/** The DDL a save would run, without running it. */
	preview: async (event) => {
		await requireRole(event, WRITERS);
		const data = await event.request.formData();
		const schema = parseSchema(data.get('schema'));
		if (!schema || !schema.name) return fail(400, { scope: 'preview' as const, error: 'Name the table before previewing it.' });
		const intent = String(data.get('intent') ?? 'look');
		// A save runs the renames through their own route before the definition,
		// so the preview is asked about the definition with those fields under
		// their old names. Asked about the new names it reads each rename as an
		// added column and a dropped one, which is not what the save does.
		const back = new Map(parseRenames(data.get('renames')).map((r) => [r.to, r.from]));
		const asDiffed = back.size
			? { ...schema, fields: schema.fields.map((f) => (back.has(f.name) ? { ...f, name: back.get(f.name) as string } : f)) }
			: schema;
		try {
			const r = await retryBusy(() =>
				authedClient(event).post<{ statements: DryRunStatement[] }>(`/api/admin/schemas/${path(schema.name)}/preview-ddl`, asDiffed),
			);
			return { scope: 'preview' as const, intent, statements: r.statements ?? [] };
		} catch (err) {
			return fail(statusOf(err), { scope: 'preview' as const, intent, error: actionError(err, 'The DDL could not be previewed.') });
		}
	},

	delete: async (event) => {
		await requireRole(event, WRITERS);
		const name = String((await event.request.formData()).get('name') ?? '');
		if (!name) return fail(400, { scope: 'delete' as const, error: 'Pick a schema to delete.' });
		try {
			await retryBusy(() => authedClient(event).delete(`/api/admin/schemas/${path(name)}`));
			return { scope: 'delete' as const, deleted: name };
		} catch (err) {
			return fail(statusOf(err), { scope: 'delete' as const, error: actionError(err, 'The schema could not be deleted.') });
		}
	},

	/** Moves the table and every row in it to a new machine name. */
	rename: async (event) => {
		await requireRole(event, WRITERS);
		const data = await event.request.formData();
		const from = String(data.get('from') ?? '');
		const to = String(data.get('to') ?? '').trim();
		if (!from || !to) return fail(400, { scope: 'rename' as const, error: 'Enter the new machine name.' });
		try {
			const saved = await retryBusy(() =>
				authedClient(event).put<Schema>(`/api/admin/schemas/${path(from, 'rename')}`, { new_name: to }),
			);
			return { scope: 'rename' as const, from, saved };
		} catch (err) {
			return fail(statusOf(err), { scope: 'rename' as const, error: actionError(err, 'The schema could not be renamed.') });
		}
	},

	/** What each save ran against the table and what is still queued. */
	history: async (event) => {
		// The engine holds this to super_admin: the table behind a name is shared
		// by every tenant that defines it, so its history is theirs too.
		await requireRole(event, ['super_admin']);
		const name = String((await event.request.formData()).get('name') ?? '');
		if (!name) return fail(400, { scope: 'history' as const, error: 'Pick a schema.' });
		try {
			const r = await authedClient(event).get<{ entries: HistoryEntry[]; pending: number; limit: number }>(
				`/api/admin/schemas/${path(name)}/history`,
			);
			return { scope: 'history' as const, name, entries: r.entries ?? [], pending: r.pending ?? 0, limit: r.limit ?? 200 };
		} catch (err) {
			if (err instanceof ApiError && err.status === 404) {
				return fail(404, { scope: 'history' as const, name, error: 'The engine answered no history for this schema. It may not serve one yet.' });
			}
			return fail(statusOf(err), { scope: 'history' as const, name, error: actionError(err, 'The history could not be read.') });
		}
	},

	/** Runs the drops a save queued for this one table. */
	applyPending: async (event) => {
		await requireRole(event, ['super_admin']);
		const name = String((await event.request.formData()).get('name') ?? '');
		if (!name) return fail(400, { scope: 'applyPending' as const, error: 'Pick a schema.' });
		try {
			const r = await retryBusy(() =>
				authedClient(event).post<{ applied: number; canceled?: number }>(`/api/admin/schemas/${path(name)}/apply-pending`, {}),
			);
			return { scope: 'applyPending' as const, name, applied: r.applied ?? 0, canceled: r.canceled ?? 0 };
		} catch (err) {
			return fail(statusOf(err), { scope: 'applyPending' as const, name, error: actionError(err, 'The queued changes could not be applied.') });
		}
	},

	/**
	 * Imports content types, in two steps. Without `apply` the engine answers
	 * the plan: which schemas it would create or change and the DDL each one
	 * runs. With it, the plan runs.
	 */
	import: async (event) => {
		await requireRole(event, ['super_admin']);
		const data = await event.request.formData();
		const body = await readImportForm(data);
		if (!body) return fail(400, { scope: 'import' as const, error: 'Choose a file or paste the definitions.' });
		const source = String(data.get('source') ?? 'lyeve');
		if (!IMPORT_SOURCES.some((s) => s.value === source)) {
			return fail(400, { scope: 'import' as const, error: 'Pick where the definitions come from.' });
		}
		const apply = data.get('apply') === 'true';
		const query = new URLSearchParams({ from: source, ...(apply ? { apply: 'true' } : {}) });
		const payload = 'file' in body ? body.file : body.content;
		const type = 'file' in body ? await bundleContentType(body.file) : body.format === 'json' ? 'application/json' : 'application/yaml';

		let res: Response;
		try {
			res = await event.fetch(`/api/admin/schemas/import?${query}`, {
				method: 'POST',
				headers: { ...flowAuthHeaders(event), 'Content-Type': type },
				body: payload,
			});
		} catch {
			return fail(502, { scope: 'import' as const, error: 'The engine did not answer. Nothing was imported.' });
		}
		const reply = (await res.json().catch(() => ({}))) as {
			error?: string;
			applied?: boolean;
			plan?: ImportPlan;
			renamed?: Record<string, string>;
			notes?: { schema: string; field?: string; message: string }[];
		};
		if (!res.ok) {
			// 4xx carries the engine's reason about the file, which is what the
			// operator has to change. Anything else is said in our own words.
			const relay = res.status >= 400 && res.status < 500 && reply.error ? reply.error : '';
			return fail(res.status, {
				scope: 'import' as const,
				error: relay || 'The definitions could not be imported.',
				plan: reply.plan ?? null,
			});
		}
		return {
			scope: 'import' as const,
			applied: reply.applied === true,
			plan: reply.plan ?? { schemas: [] },
			renamed: reply.renamed ?? {},
			notes: reply.notes ?? [],
		};
	},

	preset: async (event) => {
		await requireUser(event);
		const client = authedClient(event);
		const data = await event.request.formData();
		const id = String(data.get('id') ?? '').trim();
		if (!id) return fail(400, { error: 'Choose a preset.', preset: '' });

		try {
			const result = await applySchemaPreset(client, id);
			return { preset: id, created: result.created ?? [] };
		} catch (err) {
			// 409 is the one refusal that names something the operator can act
			// on: a schema of that name is already here. The plugin's sentence
			// says which, so it is relayed beside the preset it belongs to.
			if (err instanceof ApiError && err.status === 409) {
				return fail(409, { error: actionError(err, 'A schema this preset creates already exists.'), preset: id });
			}
			if (err instanceof ApiError && err.status === 404) {
				return fail(404, { error: 'This install does not ship this preset.', preset: id });
			}
			return fail(400, { error: actionError(err, 'The preset could not be created.'), preset: id });
		}
	},

	savePreset: async (event) => {
		await requireUser(event);
		const client = authedClient(event);
		const data = await event.request.formData();
		const url = String(data.get('url') ?? '').trim();
		const file = data.get('file');
		let document = String(data.get('document') ?? '').trim();
		if (!document && file instanceof File && file.size > 0) document = (await file.text()).trim();
		if (!url && !document) return fail(400, { saveError: 'Give a URL, a file or a pasted preset.' });
		if (url && document) return fail(400, { saveError: 'Give a URL or a document, not both.' });
		try {
			const saved = await saveSchemaPreset(client, url ? { url } : { document });
			return { savedPreset: saved.id };
		} catch (err) {
			const refused = refusalOf(err);
			if (refused) return fail(402, { saveError: refusalText(refused), refused });
			if (err instanceof ApiError && err.status === 409) {
				return fail(409, { saveError: 'A built-in preset already uses that id. Give yours another.' });
			}
			if (err instanceof ApiError && err.status === 502) {
				return fail(502, { saveError: 'The URL did not answer with a preset document.' });
			}
			return fail(400, { saveError: actionError(err, 'The preset could not be saved.') });
		}
	},

	// The canvas saves after every gesture that moves a node. The page sends
	// the whole map, and the plugin replaces what it holds with it.
	saveLayout: async (event) => {
		await requireUser(event);
		const client = authedClient(event);
		let positions;
		try {
			positions = parsePositions(JSON.parse(String((await event.request.formData()).get('positions') ?? '{}')));
		} catch {
			return fail(400, { layoutError: 'The layout could not be read.' });
		}
		try {
			await saveCanvasLayout(client, positions);
			return { layoutSaved: true };
		} catch (err) {
			const refused = refusalOf(err);
			if (refused) return fail(402, { layoutError: refusalText(refused), refused });
			return fail(400, { layoutError: actionError(err, 'The layout could not be saved.') });
		}
	},

	deletePreset: async (event) => {
		await requireUser(event);
		const client = authedClient(event);
		const id = String((await event.request.formData()).get('id') ?? '').trim();
		if (!id) return fail(400, { error: 'Choose a preset.', preset: '' });
		try {
			await deleteSchemaPreset(client, id);
			return { deletedPreset: id };
		} catch (err) {
			return fail(400, { error: actionError(err, 'The preset could not be deleted.'), preset: id });
		}
	},
};
