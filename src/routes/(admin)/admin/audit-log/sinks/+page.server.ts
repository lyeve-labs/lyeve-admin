import type { Actions, PageServerLoad } from './$types';
import { fail } from '@sveltejs/kit';
import { authedClient, requireRole } from '$lib/server/authz';
import { actionError } from '$lib/server/action-error';
import { refusalOf, refusalText } from '$lib/api/refusal';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning } from '$lib/plugins';
import { GATE_OK, gateOf, type Gate } from '$lib/api/gate';
import { createSink, deleteSink, isSinkKind, listSinks, testSink, updateSink, type AuditSink } from '$lib/api/audit-sinks';

const ADMINS = ['admin', 'super_admin'];

export const load: PageServerLoad = async (event) => {
	const { plugins } = await event.parent();
	let sinks: AuditSink[] = [];
	let gate: Gate = notRunning(plugins, PLUGIN.audit) ? { state: 'absent' } : GATE_OK;
	if (gate.state === 'ok') {
		try {
			sinks = await listSinks(authedClient(event));
		} catch (err) {
			gate = gateOf(err, 'Streaming destinations could not be read. This is not a report that there are none.');
		}
	}
	return { sinks, gate };
};

function text(form: FormData, key: string): string {
	return String(form.get(key) ?? '').trim();
}

/** The fields both writes share, read the same way. */
function common(form: FormData) {
	return {
		name: text(form, 'name'),
		url: text(form, 'url'),
		splunk_index: text(form, 'splunk_index'),
		datadog_service: text(form, 'datadog_service'),
		datadog_tags: text(form, 'datadog_tags'),
		enabled: form.get('enabled') === 'true',
	};
}

/**
 * A failed write, tagged with the action that made it. Every form on the page
 * reports through one result, and the tag is how the drawer tells its own
 * failure from a delete or a test made from a row.
 */
function failure(action: string, err: unknown, fallback: string) {
	const refused = refusalOf(err);
	if (refused) return fail(402, { action, error: refusalText(refused), refused });
	return fail(400, { action, error: actionError(err, fallback) });
}

function missing(action: string, body: { name: string; url: string }) {
	const fields: Record<string, string> = {};
	if (!body.name) fields.name = 'Name is required';
	if (!body.url) fields.url = 'URL is required';
	return Object.keys(fields).length ? fail(400, { action, error: 'Check the highlighted fields.', fields }) : null;
}

export const actions: Actions = {
	create: async (event) => {
		await requireRole(event, ADMINS);
		const form = await event.request.formData();
		const kind = text(form, 'kind');
		if (!isSinkKind(kind)) return fail(400, { action: 'create', error: 'Pick where the log is sent.' });
		const body = common(form);
		const refused = missing('create', body);
		if (refused) return refused;
		const secret = text(form, 'secret');
		if (kind !== 'https' && !secret) {
			return fail(400, {
				action: 'create',
				error: 'Check the highlighted fields.',
				fields: { secret: kind === 'splunk' ? 'The HEC token is required' : 'The API key is required' },
			});
		}
		try {
			const created = await createSink(authedClient(event), {
				...body,
				kind,
				...(secret ? { secret } : {}),
				backfill: form.get('backfill') === 'true',
			});
			// A secret the plugin generated is in this answer and nowhere else.
			return { created: created.name, secret: created.secret ?? '' };
		} catch (err) {
			return failure('create', err, 'The destination could not be created.');
		}
	},

	update: async (event) => {
		await requireRole(event, ADMINS);
		const form = await event.request.formData();
		const id = text(form, 'id');
		if (!id) return fail(400, { action: 'update', error: 'No destination was named.' });
		const body = common(form);
		const refused = missing('update', body);
		if (refused) return refused;
		const secret = text(form, 'secret');
		try {
			await updateSink(authedClient(event), id, { ...body, ...(secret ? { secret } : {}) });
		} catch (err) {
			return failure('update', err, 'The destination could not be saved.');
		}
		return { saved: body.name };
	},

	delete: async (event) => {
		await requireRole(event, ADMINS);
		const form = await event.request.formData();
		const id = text(form, 'id');
		if (!id) return fail(400, { action: 'delete', error: 'No destination was named.' });
		try {
			await deleteSink(authedClient(event), id);
		} catch (err) {
			return failure('delete', err, 'The destination could not be deleted.');
		}
		return { deleted: true };
	},

	test: async (event) => {
		await requireRole(event, ADMINS);
		const form = await event.request.formData();
		const id = text(form, 'id');
		if (!id) return fail(400, { action: 'test', error: 'No destination was named.' });
		try {
			const res = await testSink(authedClient(event), id);
			return { tested: id, delivered: res.delivered, testError: res.error ?? '' };
		} catch (err) {
			return failure('test', err, 'The test could not be sent.');
		}
	},
};
