import type { Actions, PageServerLoad } from './$types';
import { fail } from '@sveltejs/kit';
import { ApiError, createClient } from '@lyeve-labs/client';
import { authedClient, requireUser } from '$lib/server/authz';
import { actionError } from '$lib/server/action-error';
import { flowLoadOutcome } from '$lib/server/flow-load';
import { flowClient } from '$lib/server/flow-client';
import {
	createDatasource,
	deleteDatasource,
	listDatasources,
	testDatasource,
	updateDatasource,
	type Datasource,
	type DatasourceBody,
	type DatasourceKind,
} from '$lib/api/flows';
import { SSL_MODES, authFromForm } from '$lib/flow/datasources';
import { sessionToken } from '$lib/server/session-cookie';

const KINDS: DatasourceKind[] = ['postgres', 'mysql', 'mssql', 'http', 'google_sheets'];

export const load: PageServerLoad = async ({ fetch, cookies, url }) => {
	const token = sessionToken({ cookies, url }) ?? '';
	const client = createClient(fetch, { Authorization: `Bearer ${token}` });
	let datasources: Datasource[] = [];
	// The list says whether this instance may use datasources. Without that
	// it is empty by design and a create is refused, and the page has to say
	// which of the two empties this is. A failed read leaves it enabled, so
	// the banner is what the page draws, not a locked state.
	let available = true;
	let locked = false;
	let loadError: string | null = null;
	try {
		({ rows: datasources, enabled: available } = await listDatasources(client));
	} catch (err) {
		({ locked, loadError } = flowLoadOutcome(err, { cookies, url }, 'datasources'));
	}
	return { datasources, available, locked, loadError };
};

/**
 * A write the plugin refused because this instance does not enable
 * datasources. A stored one can still be read and deleted, so the refusal
 * names the feature and leaves the rest of the page as it was.
 */
function isRefused(err: unknown): boolean {
	return err instanceof ApiError && err.status === 402;
}

const REFUSED = { error: 'Datasources are not enabled on this instance, so nothing was changed.', refused: true };

const on = (v: FormDataEntryValue | null): boolean => v === 'true' || v === 'on';
const text = (data: FormData, key: string): string => String(data.get(key) ?? '').trim();

/**
 * The body for one kind, split into what the engine stores in the clear and
 * what it encrypts. A blank secret on an update means "keep the stored one",
 * so it is left out rather than sent empty.
 */
function bodyFrom(data: FormData): DatasourceBody | string {
	const name = text(data, 'name');
	const kind = text(data, 'kind') as DatasourceKind;
	if (!name) return 'A datasource needs a name.';
	if (!KINDS.includes(kind)) return 'Choose a kind.';

	const config: Record<string, unknown> = {};
	const secret: Record<string, unknown> = {};

	if (kind === 'postgres' || kind === 'mysql' || kind === 'mssql') {
		config.host = text(data, 'host');
		config.port = Number(text(data, 'port')) || undefined;
		config.database = text(data, 'database');
		config.user = text(data, 'user');
		const modes = SSL_MODES[kind].map((m) => m.value);
		const ssl = text(data, 'ssl') || modes[0];
		if (!modes.includes(ssl)) return `TLS must be one of ${modes.join(', ')} for ${kind}.`;
		config.ssl = ssl;
		const password = text(data, 'password');
		if (password) secret.password = password;
		if (!config.host || !config.database) return 'Host and database are required.';
	} else if (kind === 'http') {
		config.base_url = text(data, 'base_url');
		if (!config.base_url) return 'A base URL is required.';
		const chatId = text(data, 'chat_id');
		if (chatId) config.chat_id = chatId;
		const keys = data.getAll('header_key').map(String);
		const values = data.getAll('header_value').map(String);
		const secrets = data.getAll('header_secret').map(String);
		const plain: Record<string, string> = {};
		const hidden: Record<string, string> = {};
		keys.forEach((k, i) => {
			const key = k.trim();
			if (!key) return;
			const value = values[i] ?? '';
			if (secrets[i] === 'true') {
				if (value) hidden[key] = value;
			} else {
				plain[key] = value;
			}
		});
		config.headers = plain;
		if (Object.keys(hidden).length > 0) secret.headers = hidden;
		const auth = authFromForm(data);
		if (typeof auth === 'string') return auth;
		if (auth.auth) config.auth = auth.auth;
		Object.assign(secret, auth.secret ?? {});
	} else {
		const apiBase = text(data, 'api_base');
		if (apiBase) config.api_base = apiBase;
		const json = text(data, 'service_account_json');
		if (json) secret.service_account_json = json;
	}

	return {
		name,
		kind,
		config,
		secret: Object.keys(secret).length > 0 ? secret : undefined,
		allow_writes: on(data.get('allow_writes')),
		allow_private: on(data.get('allow_private')),
	};
}

export const actions: Actions = {
	create: async (event) => {
		await requireUser(event);
		const client = flowClient(event);
		const body = bodyFrom(await event.request.formData());
		if (typeof body === 'string') return fail(400, { error: body });
		try {
			await createDatasource(client, body);
		} catch (err) {
			if (isRefused(err)) return fail(402, REFUSED);
			return fail(400, { error: actionError(err, 'Failed to create datasource') });
		}
	},

	update: async (event) => {
		await requireUser(event);
		const client = authedClient(event);
		const data = await event.request.formData();
		const id = text(data, 'id');
		const body = bodyFrom(data);
		if (typeof body === 'string') return fail(400, { error: body });
		try {
			await updateDatasource(client, id, body);
		} catch (err) {
			if (isRefused(err)) return fail(402, REFUSED);
			return fail(400, { error: actionError(err, 'Failed to update datasource') });
		}
	},

	delete: async (event) => {
		await requireUser(event);
		const client = authedClient(event);
		const data = await event.request.formData();
		try {
			await deleteDatasource(client, text(data, 'id'));
		} catch (err) {
			return fail(400, { error: actionError(err, 'Failed to delete datasource') });
		}
	},

	test: async (event) => {
		await requireUser(event);
		const client = authedClient(event);
		const data = await event.request.formData();
		const id = text(data, 'id');
		try {
			const result = await testDatasource(client, id);
			return { testResult: { id, ...result } };
		} catch (err) {
			if (isRefused(err)) return fail(402, REFUSED);
			return fail(400, { error: actionError(err, 'Failed to test datasource') });
		}
	},
};
