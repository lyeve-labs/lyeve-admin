import type { Actions, PageServerLoad } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { ApiError, createClient } from '@lyeve-labs/client';
import { authedClient, requireUser } from '$lib/server/authz';
import { actionError } from '$lib/server/action-error';
import { flowAuthHeaders, readImportForm } from '$lib/server/flow-import';
import { flowClient } from '$lib/server/flow-client';
import { forbiddenFailure } from '$lib/server/flow-forbidden';
import { refusalFailure } from '$lib/server/flow-refusal';
import { flowLoadOutcome } from '$lib/server/flow-load';
import { pageWindow, pastEndOffset, withOffset } from '$lib/api/list';
import {
	ImportError,
	FlowRefusal,
	createFlow,
	deleteFlow,
	importFlow,
	listFlows,
	validationErrors,
	type Flow,
	type ImportResult,
} from '$lib/api/flows';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 199;

function isLocked(err: unknown): boolean {
	return err instanceof ApiError && err.status === 402;
}

export const load: PageServerLoad = async ({ fetch, cookies, url }) => {
	const client = createClient(fetch, flowAuthHeaders({ cookies, url }));
	const { limit, offset } = pageWindow(url, DEFAULT_LIMIT, MAX_LIMIT);
	const status = url.searchParams.get('status') ?? '';
	const q = url.searchParams.get('q') ?? '';

	// One row past the page answers "is there another page" when the endpoint
	// states no total. It is never rendered.
	let locked = false;
	let loadError: string | null = null;
	let flows: Flow[] = [];
	let total: number | null = null;
	let hasMore = false;
	// Whether the caller may create rides beside the list. A failed read
	// leaves it allowed: the engine decides, and its refusal renders.
	let canCreate = true;
	try {
		const page = await listFlows(client, { limit: limit + 1, offset, status, q });
		canCreate = page.canCreate;
		flows = page.rows.slice(0, limit);
		total = page.total;
		hasMore = total === null ? page.rows.length > limit : offset + flows.length < total;
	} catch (err) {
		({ locked, loadError } = flowLoadOutcome(err, { cookies, url }, 'flows'));
	}

	const back = pastEndOffset(flows.length, limit, offset, total);
	if (back !== null) redirect(307, withOffset(url, back));

	return {
		flows,
		limit,
		offset,
		total,
		hasMore,
		status,
		q,
		locked,
		loadError,
		canCreate,
	};
};

/** The 422 shape, surfaced as a form failure the page can list. */
function validationFailure(err: unknown, fallback: string) {
	if (err instanceof ApiError && err.status === 422) {
		return fail(422, { error: 'The definition did not validate.', errors: validationErrors(err.message) });
	}
	if (err instanceof ImportError && err.status === 422) {
		return fail(422, { error: 'The definition did not validate.', errors: validationErrors(err.body) });
	}
	if (err instanceof FlowRefusal) return refusalFailure(err);
	if (isLocked(err)) return fail(402, { error: 'Flows are not enabled on this instance.', locked: true });
	if (err instanceof ApiError && err.status === 403) return forbiddenFailure(err);
	return fail(400, { error: actionError(err, fallback) });
}

export const actions: Actions = {
	create: async (event) => {
		await requireUser(event);
		const client = flowClient(event);
		const data = await event.request.formData();
		const name = String(data.get('name') ?? '').trim();
		const slug = String(data.get('slug') ?? '').trim();
		if (!name || !slug) return fail(400, { error: 'Name and slug are required.' });

		// A name and a slug, nothing else: the flow starts empty and the editor
		// offers the palette, the templates and an import once it is open.
		let created: Flow;
		try {
			created = await createFlow(client, { name, slug });
		} catch (err) {
			return validationFailure(err, 'Failed to create flow');
		}
		redirect(303, `/admin/flows/${encodeURIComponent(created.id)}`);
	},

	delete: async (event) => {
		await requireUser(event);
		const client = authedClient(event);
		const data = await event.request.formData();
		const id = String(data.get('id') ?? '');
		try {
			await deleteFlow(client, id);
		} catch (err) {
			if (err instanceof ApiError && err.status === 403) return forbiddenFailure(err);
			return fail(400, { error: actionError(err, 'Failed to delete flow') });
		}
	},

	import: async (event) => {
		await requireUser(event);
		const data = await event.request.formData();
		const mode = data.get('mode') === 'replace' ? 'replace' : 'create';
		const slug = String(data.get('slug') ?? '').trim() || undefined;

		const body = await readImportForm(data);
		if (!body) return fail(400, { error: 'Paste a definition or choose a file.' });
		if (mode === 'replace' && !slug) return fail(400, { error: 'Replace needs the slug of the flow to replace.' });

		let result: ImportResult;
		try {
			result = await importFlow(event.fetch, { ...body, mode, slug }, flowAuthHeaders(event));
		} catch (err) {
			if (err instanceof FlowRefusal) return refusalFailure(err);
			if (err instanceof ImportError && err.status === 402) {
				return fail(402, { error: 'Flows are not enabled on this instance.', locked: true });
			}
			if (err instanceof ImportError) {
				if (err.status === 422) return validationFailure(err, 'Import failed');
				return fail(400, { error: err.status < 500 && err.message ? err.message : 'Import failed' });
			}
			return fail(400, { error: 'Import failed' });
		}
		const unresolved = result.unresolved_datasources ?? [];
		if (unresolved.length > 0) {
			return { imported: { id: result.id, name: result.name, unresolved } };
		}
		redirect(303, `/admin/flows/${encodeURIComponent(result.id)}`);
	},
};
