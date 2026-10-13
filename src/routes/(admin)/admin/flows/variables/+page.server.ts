import type { Actions, PageServerLoad } from './$types';
import { fail } from '@sveltejs/kit';
import { createClient } from '@lyeve-labs/client';
import { authedClient, requireUser } from '$lib/server/authz';
import { actionError } from '$lib/server/action-error';
import { engineBanner, flowLoadOutcome } from '$lib/server/flow-load';
import { GATE_OK, gateOf, type Gate } from '$lib/api/gate';
import { deleteVariable, listVariables, putVariable, type Variable } from '$lib/api/flows';
import { pageWindow, rowsOf, totalOf } from '$lib/api/list';
import { sessionToken } from '$lib/server/session-cookie';

const KEY = /^[a-z][a-z0-9_]{0,39}$/;

export const load: PageServerLoad = async ({ fetch, cookies, url }) => {
	const token = sessionToken({ cookies, url }) ?? '';
	const client = createClient(fetch, { Authorization: `Bearer ${token}` });
	const { limit, offset } = pageWindow(url, 50, 500);
	let variables: Variable[] = [];
	let total = 0;
	let locked = false;
	// Why the list could not be read. The plugin answers it to an admin only,
	// so a reader below admin sees the role refusal and nothing to create.
	let gate: Gate = GATE_OK;
	try {
		const res = await listVariables(client, limit, offset);
		variables = rowsOf(res);
		total = Math.max(totalOf(res), offset + variables.length);
	} catch (err) {
		({ locked } = flowLoadOutcome(err, { cookies, url }, 'variables'));
		if (!locked) gate = gateOf(err, engineBanner('variables'));
	}
	return { variables, total, limit, offset, locked, gate };
};

export const actions: Actions = {
	put: async (event) => {
		await requireUser(event);
		const client = authedClient(event);
		const data = await event.request.formData();
		const key = String(data.get('key') ?? '').trim();
		const value = String(data.get('value') ?? '');
		const isSecret = data.get('is_secret') === 'true' || data.get('is_secret') === 'on';
		if (!KEY.test(key)) {
			return fail(400, { action: 'put', error: 'A key is lower case letters, digits and underscores, starting with a letter.', key });
		}
		// A secret is write-only: the edit form shows an empty field and blank
		// means keep what is stored, so there is nothing to send.
		if (isSecret && !value && data.get('existing') === 'true') return {};
		try {
			await putVariable(client, { key, value, is_secret: isSecret });
		} catch (err) {
			return fail(400, { action: 'put', error: actionError(err, 'Failed to save variable'), key });
		}
		return { saved: key };
	},

	delete: async (event) => {
		await requireUser(event);
		const client = authedClient(event);
		const data = await event.request.formData();
		const key = String(data.get('key') ?? '').trim();
		try {
			await deleteVariable(client, key);
		} catch (err) {
			return fail(400, { action: 'delete', error: actionError(err, 'Failed to delete variable') });
		}
	},
};
