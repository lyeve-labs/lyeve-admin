import type { PageServerLoad, Actions } from './$types';
import { fail } from '@sveltejs/kit';
import { authedClient, requireRole } from '$lib/server/authz';
import { actionError } from '$lib/server/action-error';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning } from '$lib/plugins';
import {
	RETENTION_OK,
	createHold,
	createPolicy,
	deletePolicy,
	enforceNow,
	listHolds,
	listPolicies,
	releaseHold,
	retentionGate,
	type LegalHold,
	type RetentionGate,
	type RetentionPolicy,
} from '$lib/api/retention';
import { rowsOf } from '$lib/api/list';

export const load: PageServerLoad = async (event) => {
	const { plugins } = await event.parent();

	const client = authedClient(event);
	let policies: RetentionPolicy[] = [];
	// The shell says why the page is unavailable while its plugin does not run.
	let gate: RetentionGate = notRunning(plugins, PLUGIN.audit) ? { state: 'absent' } : RETENTION_OK;
	if (gate.state === 'ok') {
		try {
			policies = rowsOf(await listPolicies(client));
		} catch (err) {
			gate = retentionGate(err);
		}
	}

	// The two halves have to be read together or the page lies: a policy alone
	// does not mean entries are being deleted, because a hold overrides it.
	// An unread hold list is never drawn as no holds.
	const holds =
		gate.state === 'ok'
			? await listHolds(client)
					.then((h) => ({ rows: rowsOf(h), read: true }))
					.catch(() => ({ rows: [] as LegalHold[], read: false }))
			: { rows: [] as LegalHold[], read: false };

	return { policies, holds: holds.rows, holdsRead: holds.read, gate };
};

export const actions: Actions = {
	createPolicy: async (event) => {
		await requireRole(event, ['super_admin']);
		const client = authedClient(event);
		const form = await event.request.formData();

		const days = Number(form.get('retention_days'));
		if (!Number.isFinite(days) || days < 0 || !Number.isInteger(days)) {
			return fail(400, { error: 'A retention window is a whole number of days, and cannot be negative.' });
		}
		const archival = form.get('archival_enabled') === 'true';
		const storage = String(form.get('archival_storage') ?? '').trim();
		if (archival && !storage) {
			return fail(400, {
				error: 'Archival is on but no storage backend is named, so there is nowhere to archive to and the entries would be deleted outright.',
			});
		}

		try {
			await createPolicy(client, {
				event_type: String(form.get('event_type') ?? '').trim(),
				resource_type: String(form.get('resource_type') ?? '').trim(),
				retention_days: days,
				archival_enabled: archival,
				archival_storage: storage,
				archival_path_prefix: String(form.get('archival_path_prefix') ?? '').trim(),
			});
		} catch (err) {
			return fail(400, { error: actionError(err, 'The policy could not be created.') });
		}
		return { saved: 'policy' };
	},

	deletePolicy: async (event) => {
		await requireRole(event, ['super_admin']);
		const client = authedClient(event);
		const form = await event.request.formData();
		const id = String(form.get('id') ?? '');
		if (!id) return fail(400, { error: 'No policy was named.' });
		try {
			await deletePolicy(client, id);
		} catch (err) {
			return fail(400, { error: actionError(err, 'The policy could not be removed.') });
		}
		return { removed: id };
	},

	createHold: async (event) => {
		await requireRole(event, ['super_admin']);
		const client = authedClient(event);
		const form = await event.request.formData();
		const name = String(form.get('name') ?? '').trim();
		if (!name) {
			return fail(400, { error: 'Name the hold. Somebody has to be able to tell later what it was for.' });
		}
		try {
			await createHold(client, {
				name,
				description: String(form.get('description') ?? '').trim(),
				filter_action: String(form.get('filter_action') ?? '').trim(),
				filter_resource_type: String(form.get('filter_resource_type') ?? '').trim(),
				filter_resource_id: String(form.get('filter_resource_id') ?? '').trim(),
				filter_tenant_id: String(form.get('filter_tenant_id') ?? '').trim(),
			});
		} catch (err) {
			return fail(400, { error: actionError(err, 'The hold could not be created.') });
		}
		return { saved: name };
	},

	releaseHold: async (event) => {
		await requireRole(event, ['super_admin']);
		const client = authedClient(event);
		const form = await event.request.formData();
		const id = String(form.get('id') ?? '');
		if (!id) return fail(400, { error: 'No hold was named.' });
		try {
			await releaseHold(client, id);
		} catch (err) {
			return fail(400, { error: actionError(err, 'The hold could not be released.') });
		}
		return { released: id };
	},

	// Deletes. Not a dry run, and nothing undoes it.
	enforce: async (event) => {
		await requireRole(event, ['super_admin']);
		const client = authedClient(event);
		try {
			const result = await enforceNow(client);
			return { enforced: true, deleted: result.deleted ?? 0 };
		} catch (err) {
			return fail(400, { error: actionError(err, 'Retention could not be enforced.') });
		}
	},
};
