import type { PageServerLoad, Actions } from './$types';
import { fail } from '@sveltejs/kit';
import { staticGroups, type EndpointGroup } from '$lib/api/reference';
import { buildReference, type OpenAPIDocument } from '$lib/api/openapi';
import type { HttpClient } from '@lyeve-labs/client';
import { GATE_OK, gateOf, type Gate } from '$lib/api/gate';
import { authedClient, authedHeaders, loadUser } from '$lib/server/authz';
import {
	GRAPHQL_URL,
	GRPC_INVOKE_URL,
	buildPath,
	buildQuery,
	byteLength,
	isSameOriginPath,
	findEndpoint,
	formatBody,
	graphqlMutates,
	grpcRouteParams,
	grpcRouteTakesBody,
	labEndpoints,
	labResultFromInvoke,
	parseVariables,
	pickHeaders,
	type GrpcInvokeResult,
	type LabResult,
} from '$lib/api/labs';

/**
 * A lab request is capped so a mistake stays a mistake.
 *
 * A tester who asks for a million rows should get a timeout rather than a
 * page that never renders, and a body larger than this is a file upload,
 * which belongs in the media screens where progress and resumption exist.
 */
const TIMEOUT_MS = 20_000;
const MAX_BODY_BYTES = 256 * 1024;

/** The response text kept. Past this the page is unreadable anyway. */
const MAX_SHOWN_CHARS = 512 * 1024;

/**
 * The endpoints a lab may send, read from the engine every time.
 *
 * This is the allowlist, not a convenience. It is read again inside the send
 * rather than taken from the page's data or the submitted form, because
 * anything that travels through the browser is the caller's to choose, and an
 * allowlist the caller can choose is not one.
 */
async function readGroups(client: HttpClient): Promise<{ groups: EndpointGroup[]; source: 'engine' | 'catalog' }> {
	try {
		const doc = await client.get<OpenAPIDocument | null>('/api/admin/openapi.json', {
			headers: { Accept: 'application/json' },
		});
		if (doc && typeof doc.paths === 'object') {
			return { groups: buildReference(doc, staticGroups).groups, source: 'engine' };
		}
	} catch {
		// The catalog alone still lists endpoints worth trying, and the page
		// says which it is showing rather than implying the engine answered.
	}
	return { groups: staticGroups, source: 'catalog' };
}

/** What the gRPC tab says when the listener's status could not be read. */
const GRPC_FAILED = 'The gRPC listener status could not be read. This is not a report that the plugin is absent.';

export const load: PageServerLoad = async (event) => {
	const user = await loadUser(event);
	const client = authedClient(event);
	const { groups, source } = await readGroups(client);
	// The listener's status and the invoke route are a super admin's, so the
	// read is not made for anyone else, and the tab says the role is why
	// rather than that the plugin is missing.
	const grpc = user.roles.includes('super_admin')
		? await readGrpcRoutes(client)
		: { listening: false, routes: [], gate: { state: 'forbidden' } as Gate };
	return { endpoints: labEndpoints(groups), source, grpc };
};

/**
 * The REST paths the gRPC listener transcodes, and whether it is listening.
 *
 * Read, never sent. Those paths are served by the plugin's own listener,
 * which defaults to loopback on a port of its own, so reaching them means a
 * server here fetching a different host: the request forgery primitive the
 * REST lab is built to avoid. The gRPC tab shows what that listener serves
 * and the line to call it with, and sends nothing.
 *
 * Read from the plugin's own status route so the lab offers what that
 * listener actually serves. A build without the plugin answers 404 and the
 * page says the listener is absent rather than offering paths nothing serves.
 */
async function readGrpcRoutes(client: HttpClient): Promise<{ listening: boolean; routes: string[]; gate: Gate }> {
	try {
		const body = await client.get<{ listening?: boolean; transcoded_routes?: string[] } | null>(
			'/api/admin/grpc/status',
			{ headers: { Accept: 'application/json' } },
		);
		return {
			listening: body?.listening === true,
			routes: body?.transcoded_routes ?? [],
			gate: GATE_OK,
		};
	} catch (err) {
		// A refused read is sorted the way every page sorts one: only a 404
		// says the plugin is not here, and an outage offers a retry.
		return { listening: false, routes: [], gate: gateOf(err, GRPC_FAILED) };
	}
}

/**
 * Sends one request the engine documented, as the caller.
 *
 * The host is this instance and nothing else. The path is rebuilt from the
 * endpoint's own template with each value percent-encoded into one segment,
 * so no caller-supplied string reaches the host portion, and the result is
 * checked against isSameOriginPath before it is sent. That is the whole of
 * why this action is not a request forgery primitive.
 */
async function send(
	event: Parameters<Actions[string]>[0],
	method: string,
	path: string,
	body: string | undefined,
	contentType: string,
): Promise<{ result: LabResult } | { error: string }> {
	// A raw request rather than the client, because the lab shows the reply's
	// status, headers and text as they came. The session headers carry the CSRF
	// token, without which every write a lab sends is refused with 403.
	const headers: Record<string, string> = { ...authedHeaders(event), Accept: 'application/json' };
	if (body !== undefined) headers['Content-Type'] = contentType;

	if (!isSameOriginPath(path)) {
		return { error: 'That path does not address this instance, so it was not sent.' };
	}

	const started = Date.now();
	const abort = AbortSignal.timeout(TIMEOUT_MS);
	let res: Response;
	try {
		res = await event.fetch(path, { method, headers, body, signal: abort });
	} catch (err) {
		// The runtime's own words for a failed connection can name an internal
		// address, so none of them are shown.
		const msg = err instanceof Error && err.name === 'TimeoutError'
			? `The request did not answer within ${TIMEOUT_MS / 1000} seconds.`
			: 'The request could not be sent to the engine. Try again in a moment.';
		return { error: msg };
	}

	const raw = (await res.text()).slice(0, MAX_SHOWN_CHARS);
	const { body: shown, json } = formatBody(raw, res.headers.get('content-type'));

	return {
		result: {
			method,
			path,
			status: res.status,
			statusText: res.statusText,
			durationMs: Date.now() - started,
			body: shown,
			json,
			headers: pickHeaders(res.headers),
		},
	};
}

export const actions: Actions = {
	rest: async (event) => {
		// No extra role gate. The request goes out as the caller and the
		// engine's own authorization answers it, so a lab can send nothing its
		// operator could not already send with curl. Requiring more here would
		// be a second, weaker copy of a decision the engine already makes.
		const form = await event.request.formData();
		const id = String(form.get('endpoint') ?? '');

		const { groups } = await readGroups(authedClient(event));
		const ep = findEndpoint(groups, id);
		if (!ep) {
			return fail(400, { error: 'That is not an endpoint this instance documents.' });
		}

		const values: Record<string, string> = {};
		for (const [k, v] of form.entries()) {
			if (k.startsWith('p_')) values[k.slice(2)] = String(v);
		}

		const path = buildPath(ep, values);
		if (path === null) {
			return fail(400, {
				error: 'Fill every path parameter. A path still carrying {name} is sent literally and answers 404 for the wrong reason.',
			});
		}

		const raw = String(form.get('body') ?? '').trim();
		if (byteLength(raw) > MAX_BODY_BYTES) {
			return fail(400, { error: 'That body is larger than a lab will send. Upload files from the media screens.' });
		}
		const sendBody = raw && ep.method !== 'GET' ? raw : undefined;
		if (sendBody) {
			try {
				JSON.parse(sendBody);
			} catch (err) {
				return fail(400, { error: `The body is not valid JSON: ${(err as Error).message}` });
			}
		}

		const out = await send(event, ep.method, path + buildQuery(ep, values), sendBody, 'application/json');
		if ('error' in out) return fail(504, { error: out.error });
		return { rest: out.result };
	},

	graphql: async (event) => {
		const form = await event.request.formData();
		const document = String(form.get('document') ?? '').trim();
		if (!document) return fail(400, { error: 'Write a query or a mutation to send.' });
		if (byteLength(document) > MAX_BODY_BYTES) {
			return fail(400, { error: 'That document is larger than a lab will send.' });
		}

		const vars = parseVariables(String(form.get('variables') ?? ''));
		if (!vars.ok) return fail(400, { error: vars.error });

		const payload = JSON.stringify(
			vars.value === undefined ? { query: document } : { query: document, variables: vars.value },
		);
		const out = await send(event, 'POST', GRAPHQL_URL, payload, 'application/json');
		if ('error' in out) return fail(504, { error: out.error });
		// A GraphQL error arrives inside a 200, so the page needs to know
		// whether this was a mutation regardless of what the status says.
		return { graphql: out.result, mutated: graphqlMutates(document) };
	},

	grpc: async (event) => {
		// The allowlist is what the plugin says it transcodes, read from the
		// engine here rather than taken from the form, for the same reason the
		// REST allowlist is: a list the caller can choose is not one. The
		// plugin checks it again on its side, which is where it counts.
		const form = await event.request.formData();
		const route = String(form.get('route') ?? '');

		const grpc = await readGrpcRoutes(authedClient(event));
		if (!grpc.routes.includes(route)) {
			return fail(400, { error: 'That is not a route this listener transcodes.' });
		}

		const params: Record<string, string> = {};
		for (const name of grpcRouteParams(route)) {
			const v = String(form.get(`g_${name}`) ?? '').trim();
			if (!v) {
				return fail(400, { error: `Fill ${name}. A path still carrying {${name}} answers 404 for the wrong reason.` });
			}
			params[name] = v;
		}

		const payload: Record<string, unknown> = { route, params };
		const raw = String(form.get('body') ?? '').trim();
		if (raw && grpcRouteTakesBody(route)) {
			if (byteLength(raw) > MAX_BODY_BYTES) {
				return fail(400, { error: 'That body is larger than a lab will send.' });
			}
			try {
				payload.body = JSON.parse(raw);
			} catch (err) {
				return fail(400, { error: `The body is not valid JSON: ${(err as Error).message}` });
			}
		}

		const out = await send(event, 'POST', GRPC_INVOKE_URL, JSON.stringify(payload), 'application/json');
		if ('error' in out) return fail(504, { error: out.error });

		// The engine answers 200 when the call ran, whatever the transcoded
		// handler said. Anything else is the engine refusing, and its message
		// is the useful one: 402 when the plugin is not enabled, 503 for no
		// listener.
		if (out.result.status !== 200) {
			return fail(400, { error: `The call was not run: ${out.result.status}. ${out.result.body}` });
		}
		let invoked: GrpcInvokeResult;
		try {
			invoked = JSON.parse(out.result.body) as GrpcInvokeResult;
		} catch {
			return fail(502, { error: 'The invoke route answered something that is not an invoke result.' });
		}
		return { grpc: labResultFromInvoke(invoked), grpcRoute: route };
	},
};
