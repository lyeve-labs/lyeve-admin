import type { PageServerLoad, Actions } from './$types';
import { fail } from '@sveltejs/kit';
import { authedClient, requireRole } from '$lib/server/authz';
import { actionError } from '$lib/server/action-error';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning } from '$lib/plugins';
import {
	MIN_TOKEN_LENGTH,
	SCIM_OK,
	createProvider,
	deleteProvider,
	deprovisionAction,
	listProviders,
	rotateToken,
	scimGate,
	type ScimGate,
	type ScimProvider,
} from '$lib/api/scim';
import { pageOf, pageWindow } from '$lib/api/list';

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

export const load: PageServerLoad = async (event) => {
	const { plugins } = await event.parent();
	const { limit, offset } = pageWindow(event.url, DEFAULT_LIMIT, MAX_LIMIT);

	// The shell says why the page is unavailable while its plugin does not run.
	if (notRunning(plugins, PLUGIN.scim)) {
		return {
			providers: [] as ScimProvider[],
			total: null as number | null,
			limit,
			offset,
			hasMore: false,
			gate: { state: 'absent' } as ScimGate,
		};
	}

	const client = authedClient(event);
	let providers: ScimProvider[] = [];
	let total: number | null = null;
	let hasMore = false;
	let gate: ScimGate = SCIM_OK;
	try {
		const page = pageOf(await listProviders(client, limit + 1, offset), limit, offset);
		providers = page.rows;
		total = page.total;
		hasMore = page.hasMore;
	} catch (err) {
		gate = scimGate(err);
	}

	return { providers, total, limit, offset, hasMore, gate };
};

export const actions: Actions = {
	create: async (event) => {
		await requireRole(event, ['super_admin']);
		const client = authedClient(event);
		const form = await event.request.formData();

		const name = String(form.get('name') ?? '').trim();
		const token = String(form.get('bearer_token') ?? '');
		const action = deprovisionAction(String(form.get('deprovision_action') ?? 'disable'));

		if (!name) return fail(400, { error: 'Name the connection so it can be told from the others.' });
		if (token.length < MIN_TOKEN_LENGTH) {
			return fail(400, {
				error: `The token is the whole authentication for a route that creates and deletes accounts. Use at least ${MIN_TOKEN_LENGTH} characters.`,
			});
		}
		if (!action) return fail(400, { error: 'Choose what happens to a deprovisioned account.' });

		try {
			await createProvider(client, {
				name,
				bearer_token: token,
				deprovision_on_delete: form.get('deprovision_on_delete') === 'true',
				deprovision_action: action,
			});
		} catch (err) {
			return fail(400, { error: actionError(err, 'The connection could not be created.') });
		}
		return { saved: name };
	},

	rotate: async (event) => {
		await requireRole(event, ['super_admin']);
		const client = authedClient(event);
		const form = await event.request.formData();
		const id = String(form.get('id') ?? '');
		const token = String(form.get('new_token') ?? '');
		if (!id) return fail(400, { error: 'No connection was named.' });
		if (token.length < MIN_TOKEN_LENGTH) {
			return fail(400, {
				error: `Use at least ${MIN_TOKEN_LENGTH} characters. The old token stops working the moment this one is stored.`,
			});
		}
		try {
			await rotateToken(client, id, token);
		} catch (err) {
			return fail(400, { error: actionError(err, 'The token could not be rotated.') });
		}
		return { rotated: id };
	},

	delete: async (event) => {
		await requireRole(event, ['super_admin']);
		const client = authedClient(event);
		const form = await event.request.formData();
		const id = String(form.get('id') ?? '');
		if (!id) return fail(400, { error: 'No connection was named.' });
		try {
			await deleteProvider(client, id);
		} catch (err) {
			return fail(400, { error: actionError(err, 'The connection could not be removed.') });
		}
		return { removed: id };
	},
};
