import type { Actions, PageServerLoad } from './$types';
import { fail } from '@sveltejs/kit';
import { authedClient, requireUser } from '$lib/server/authz';
import { actionError } from '$lib/server/action-error';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning } from '$lib/plugins';
import {
	GRAPHQL_OK,
	deletePersisted,
	graphqlGate,
	introspect,
	listPersisted,
	registerPersisted,
	togglePersisted,
	type GraphqlGate,
	type PersistedQuery,
	type SchemaRoots,
} from '$lib/api/graphql';

export const load: PageServerLoad = async (event) => {
	const { plugins } = await event.parent();
	// The shell says why the page is unavailable while its plugin does not run.
	if (notRunning(plugins, PLUGIN.graphql)) {
		return {
			gate: { state: 'absent' } as GraphqlGate,
			roots: null as SchemaRoots | null,
			refused: null as string | null,
			persisted: [] as PersistedQuery[],
			persistedError: null as string | null,
		};
	}

	const client = authedClient(event);
	// The schema and the allowlist are read apart: an instance that refuses
	// introspection still keeps an allowlist, and the reverse.
	const [schema, persisted] = await Promise.allSettled([introspect(client), listPersisted(client)]);
	let gate: GraphqlGate = GRAPHQL_OK;
	if (schema.status === 'rejected' && persisted.status === 'rejected') gate = graphqlGate(schema.reason);
	return {
		gate,
		roots: schema.status === 'fulfilled' ? schema.value.roots : null,
		refused: schema.status === 'fulfilled' ? schema.value.refused : null,
		persisted: persisted.status === 'fulfilled' ? persisted.value.data : [],
		persistedError: persisted.status === 'rejected' ? 'The persisted queries could not be loaded.' : null,
	};
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
