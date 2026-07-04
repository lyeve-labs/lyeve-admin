import type { Actions, PageServerLoad } from './$types';
import { ApiError, createClient } from '@lyeve-labs/client';
import { error, fail } from '@sveltejs/kit';
import {
	DESTINATION_HEADERS_REQUIRED,
	DESTINATION_KINDS,
	RESERVED_HEADERS,
	headerNameIsSound,
	listExporters,
	parseExposition,
	readDestination,
	readMetricsText,
	removeDestination,
	saveDestination,
	triggerExport,
	type DestinationKind,
	type DestinationRead,
	type ExporterHealth,
	type MetricFamily,
	type SaveDestination,
} from '$lib/api/telemetry';
import { errorCodeOf } from '$lib/api/limits';
import { refusalOf, refusalText } from '$lib/api/refusal';
import { actionError } from '$lib/server/action-error';
import { authedClient, requireRole } from '$lib/server/authz';
import { sessionToken } from '$lib/server/session-cookie';

/**
 * What the page renders.
 *
 * The metrics view is every admin's, already narrowed by the engine to the
 * caller's tenant unless the caller is a super admin. The exporters are the
 * instance's export configuration, so they are read for a super admin only
 * and are null, not empty, for anyone else: a tenant admin's page carries no
 * exporters section at all rather than an empty one.
 */
export interface TelemetryPage {
	superAdmin: boolean;
	/** null when the scrape route refused or did not answer. */
	families: MetricFamily[] | null;
	/** null for a tenant admin, and for a super admin the plugin did not answer. */
	exporters: ExporterHealth[] | null;
	/** The tenant's own destination read, null when the plugin did not answer it. */
	destination: DestinationRead | null;
}

export const load: PageServerLoad = async ({ fetch, cookies, parent, url }) => {
	const { user } = await parent();
	if (!user.roles.some((r) => ['super_admin', 'admin'].includes(r))) {
		error(403, 'Requires admin or super_admin role');
	}
	const superAdmin = user.roles.includes('super_admin');
	const token = sessionToken({ cookies, url }) ?? '';
	const client = createClient(fetch, { Authorization: `Bearer ${token}` });

	const [families, exporters, destination] = await Promise.all([
		readMetricsText(fetch, token)
			.then(parseExposition)
			.catch(() => null),
		superAdmin ? listExporters(client).catch(() => null) : Promise.resolve(null),
		readDestination(client).catch(() => null),
	]);

	const page: TelemetryPage = { superAdmin, families, exporters, destination };
	return page;
};

/** The most headers a destination carries, as the plugin bounds them. */
const MAX_HEADERS = 16;

/**
 * A destination write's failure, under keys of its own so it never shows in
 * the exporters' section. A 402 carries the refusal for RefusalNotice.
 */
function destinationFailure(err: unknown, fallback: string) {
	const refused = refusalOf(err);
	if (refused) return fail(402, { destinationError: refusalText(refused), refused });
	// The plugin keeps stored headers only while the URL keeps its host, so
	// a key is never sent somewhere the caller just chose.
	if (errorCodeOf(err) === DESTINATION_HEADERS_REQUIRED) {
		return fail(422, { destinationError: actionError(err, fallback), hostMoved: true });
	}
	return fail(400, { destinationError: actionError(err, fallback) });
}

export const actions: Actions = {
	saveDestination: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		const data = await event.request.formData();
		const kind = String(data.get('kind') ?? '') as DestinationKind;
		const url = String(data.get('url') ?? '').trim();
		if (!DESTINATION_KINDS.some((k) => k.value === kind)) {
			return fail(400, { destinationError: 'Choose OTLP or Pushgateway.' });
		}
		let parsed: URL | null = null;
		try {
			parsed = new URL(url);
		} catch {
			parsed = null;
		}
		if (!parsed || !['http:', 'https:'].includes(parsed.protocol) || url.length > 2048) {
			return fail(400, { destinationError: 'The URL is an absolute http or https address.' });
		}
		if (parsed.username || parsed.password) {
			return fail(400, { destinationError: 'Put credentials in a header, not in the URL.' });
		}

		const body: SaveDestination = { kind, url };
		if (data.get('headers_mode') === 'replace') {
			const names = data.getAll('header_name').map((v) => String(v).trim());
			const values = data.getAll('header_value').map((v) => String(v));
			const headers: Record<string, string> = {};
			for (const [i, name] of names.entries()) {
				if (!name) continue;
				if (!headerNameIsSound(name)) {
					return fail(400, { destinationError: `${name} is not a header name.` });
				}
				if (RESERVED_HEADERS.includes(name.toLowerCase())) {
					return fail(400, { destinationError: `${name} is set by the exporter itself.` });
				}
				if (/[\r\n]/.test(values[i] ?? '')) {
					return fail(400, { destinationError: 'A header value is a single line.' });
				}
				headers[name] = values[i] ?? '';
			}
			if (Object.keys(headers).length > MAX_HEADERS) {
				return fail(400, { destinationError: `A destination carries at most ${MAX_HEADERS} headers.` });
			}
			body.headers = headers;
		}

		try {
			await saveDestination(authedClient(event), body);
		} catch (err) {
			return destinationFailure(err, 'The destination could not be saved.');
		}
		return { savedDestination: true };
	},

	// Removing a destination is always allowed.
	removeDestination: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		try {
			await removeDestination(authedClient(event));
		} catch (err) {
			return destinationFailure(err, 'The destination could not be removed.');
		}
		return { removedDestination: true };
	},

	export: async (event) => {
		await requireRole(event, ['super_admin']);
		const data = await event.request.formData();
		const name = String(data.get('name') ?? '').trim();
		if (!name) return fail(400, { name, error: 'Choose an exporter.' });
		try {
			const result = await triggerExport(authedClient(event), name);
			return { name, exported: true, message: result?.message ?? `export triggered for ${name}` };
		} catch (err) {
			if (err instanceof ApiError && err.status === 429) {
				return fail(429, { name, error: `${name} exported a moment ago. Wait five seconds and try again.` });
			}
			return fail(400, { name, error: actionError(err, `The ${name} export failed.`) });
		}
	},
};
