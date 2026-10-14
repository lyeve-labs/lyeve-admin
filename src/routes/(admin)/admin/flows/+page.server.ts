import type { Actions, PageServerLoad } from './$types';
import { fail, redirect, type ActionFailure } from '@sveltejs/kit';
import { ApiError, createClient } from '@lyeve-labs/client';
import { authedClient, requireUser } from '$lib/server/authz';
import { actionError } from '$lib/server/action-error';
import { flowAuthHeaders, readImportForm } from '$lib/server/flow-import';
import { flowClient } from '$lib/server/flow-client';
import { forbiddenFailure } from '$lib/server/flow-forbidden';
import { refusalFailure } from '$lib/server/flow-refusal';
import { engineBanner, flowLoadOutcome } from '$lib/server/flow-load';
import { GATE_OK, gateOf, type Gate } from '$lib/api/gate';
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

/** The statuses the list filters by. Anything else in the address is no filter. */
const STATUSES: readonly string[] = ['draft', 'active', 'disabled', 'blocked'];

function isLocked(err: unknown): boolean {
	return err instanceof ApiError && err.status === 402;
}

export const load: PageServerLoad = async ({ fetch, cookies, url }) => {
	const client = createClient(fetch, flowAuthHeaders({ cookies, url }));
	const { limit, offset } = pageWindow(url, DEFAULT_LIMIT, MAX_LIMIT);
	// A status the list does not know would select no chip and still filter
	// the list, so it reads as no filter.
	const raw = url.searchParams.get('status') ?? '';
	const status = STATUSES.includes(raw) ? raw : '';
	const q = url.searchParams.get('q') ?? '';

	// One row past the page answers "is there another page" when the endpoint
	// states no total. It is never rendered.
	let locked = false;
	// Why the list could not be read: a role the plugin refuses, an outage or
	// a failure. Each says so in its own words and offers nothing to create.
	let gate: Gate = GATE_OK;
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
		({ locked } = flowLoadOutcome(err, { cookies, url }, 'flows'));
		if (!locked) gate = gateOf(err, engineBanner('flows'));
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
		gate,
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

/**
 * A failure tagged with the form that caused it. The create drawer, the
 * import drawer and the row's delete share one `form` result, and each shows
 * only its own failure.
 */
function tagged<F extends ActionFailure<Record<string, unknown>>>(action: string, failure: F) {
	return fail(failure.status, { ...(failure.data as F['data']), action });
}

export const actions: Actions = {
	create: async (event) => {
		await requireUser(event);
		const client = flowClient(event);
		const data = await event.request.formData();
		const name = String(data.get('name') ?? '').trim();
		const slug = String(data.get('slug') ?? '').trim();
		if (!name || !slug) return fail(400, { action: 'create', error: 'Name and slug are required.' });

		// A name and a slug, nothing else: the flow starts empty and the editor
		// offers the palette, the templates and an import once it is open.
		let created: Flow;
		try {
			created = await createFlow(client, { name, slug });
		} catch (err) {
			return tagged('create', validationFailure(err, 'Failed to create flow'));
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
			if (err instanceof ApiError && err.status === 403) return tagged('delete', forbiddenFailure(err));
			return fail(400, { action: 'delete', error: actionError(err, 'Failed to delete flow') });
		}
	},

	import: async (event) => {
		await requireUser(event);
		const data = await event.request.formData();
		const mode = data.get('mode') === 'replace' ? 'replace' : 'create';
		const slug = String(data.get('slug') ?? '').trim() || undefined;

		const body = await readImportForm(data);
		if (!body) return fail(400, { action: 'import', error: 'Paste a definition or choose a file.' });
		if (mode === 'replace' && !slug) return fail(400, { action: 'import', error: 'Replace needs the slug of the flow to replace.' });

		let result: ImportResult;
		try {
			result = await importFlow(event.fetch, { ...body, mode, slug }, flowAuthHeaders(event));
		} catch (err) {
			if (err instanceof FlowRefusal) return tagged('import', refusalFailure(err));
			if (err instanceof ImportError && err.status === 402) {
				return fail(402, { action: 'import', error: 'Flows are not enabled on this instance.', locked: true });
			}
			if (err instanceof ImportError) {
				if (err.status === 422) return tagged('import', validationFailure(err, 'Import failed'));
				return fail(400, { action: 'import', error: err.status < 500 && err.message ? err.message : 'Import failed' });
			}
			return fail(400, { action: 'import', error: 'Import failed' });
		}
		const unresolved = result.unresolved_datasources ?? [];
		if (unresolved.length > 0) {
			return { imported: { id: result.id, name: result.name, unresolved } };
		}
		redirect(303, `/admin/flows/${encodeURIComponent(result.id)}`);
	},
};
