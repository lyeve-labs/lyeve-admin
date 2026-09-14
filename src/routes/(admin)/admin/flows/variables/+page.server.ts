import type { Actions, PageServerLoad } from './$types';
import { fail } from '@sveltejs/kit';
import { createClient } from '@lyeve-labs/client';
import { authedClient, requireUser } from '$lib/server/authz';
import { actionError } from '$lib/server/action-error';
import { flowLoadOutcome } from '$lib/server/flow-load';
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
	let loadError: string | null = null;
	try {
		const res = await listVariables(client, limit, offset);
		variables = rowsOf(res);
		total = Math.max(totalOf(res), offset + variables.length);
	} catch (err) {
		({ locked, loadError } = flowLoadOutcome(err, { cookies, url }, 'variables'));
	}
	return { variables, total, limit, offset, locked, loadError };
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
			return fail(400, { error: 'A key is lower case letters, digits and underscores, starting with a letter.', key });
		}
		// A secret is write-only: the edit form shows an empty field and blank
		// means keep what is stored, so there is nothing to send.
		if (isSecret && !value && data.get('existing') === 'true') return {};
		try {
			await putVariable(client, { key, value, is_secret: isSecret });
		} catch (err) {
			return fail(400, { error: actionError(err, 'Failed to save variable'), key });
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
			return fail(400, { error: actionError(err, 'Failed to delete variable') });
		}
	},
};
