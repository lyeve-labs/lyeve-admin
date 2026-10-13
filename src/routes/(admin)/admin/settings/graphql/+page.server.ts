import type { Actions, PageServerLoad } from './$types';
import { fail } from '@sveltejs/kit';
import { authedClient, requireUser } from '$lib/server/authz';
import { actionError } from '$lib/server/action-error';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning } from '$lib/plugins';
import { section, type Section } from '$lib/api/gate';
import {
	GRAPHQL_OK,
	deletePersisted,
	introspect,
	listPersisted,
	registerPersisted,
	togglePersisted,
	type GraphqlGate,
	type PersistedQuery,
	type SchemaRoots,
} from '$lib/api/graphql';

type Schema = { roots: SchemaRoots | null; refused: string | null };

export const load: PageServerLoad = async (event) => {
	const { plugins } = await event.parent();
	// The shell says why the page is unavailable while its plugin does not run.
	if (notRunning(plugins, PLUGIN.graphql)) {
		const absent: GraphqlGate = { state: 'absent' };
		return {
			gate: absent,
			schema: { ok: false, gate: absent } as Section<Schema>,
			persisted: { ok: false, gate: absent } as Section<PersistedQuery[]>,
		};
	}

	const client = authedClient(event);
	// The schema and the allowlist are read apart: an instance that refuses
	// introspection still keeps an allowlist, and the reverse.
	const [schema, persisted] = await Promise.all([
		section(introspect(client), 'The schema could not be read. This is not a report that it is empty.'),
		section(
			listPersisted(client).then((r) => r.data),
			'The persisted queries could not be read. This is not a report that there are none.',
		),
	]);
	// Both refused is the plugin's answer as a whole, so the page says it once.
	const gate: GraphqlGate = !schema.ok && !persisted.ok ? schema.gate : GRAPHQL_OK;
	return { gate, schema, persisted };
};

const hashOf = async (event: Parameters<Actions[string]>[0]) => String((await event.request.formData()).get('hash') ?? '').trim();

export const actions: Actions = {
	register: async (event) => {
		await requireUser(event);
		const data = await event.request.formData();
		const query = String(data.get('query') ?? '').trim();
		if (!query) return fail(400, { error: 'Paste the query to allow.' });
		try {
			await registerPersisted(authedClient(event), {
				query,
				operation_name: String(data.get('operation_name') ?? '').trim(),
				description: String(data.get('description') ?? '').trim(),
			});
			return { registered: true };
		} catch (err) {
			return fail(400, { error: actionError(err, 'The query could not be registered.') });
		}
	},

	toggle: async (event) => {
		await requireUser(event);
		const hash = await hashOf(event);
		if (!hash) return fail(400, { error: 'Choose a query.' });
		try {
			await togglePersisted(authedClient(event), hash);
			return { toggled: hash };
		} catch (err) {
			return fail(400, { error: actionError(err, 'The query could not be switched.') });
		}
	},

	delete: async (event) => {
		await requireUser(event);
		const hash = await hashOf(event);
		if (!hash) return fail(400, { error: 'Choose a query.' });
		try {
			await deletePersisted(authedClient(event), hash);
			return { deleted: hash };
		} catch (err) {
			return fail(400, { error: actionError(err, 'The query could not be deleted.') });
		}
	},
};
