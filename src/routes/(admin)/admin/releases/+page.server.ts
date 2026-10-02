import type { Actions, PageServerLoad } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { authedClient, requireUser } from '$lib/server/authz';
import { actionFailure } from '$lib/server/action-error';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning } from '$lib/plugins';
import { GATE_OK, gateOf, type Gate } from '$lib/api/gate';
import { pageWindow, rowsOf, totalOf } from '$lib/api/list';
import { RELEASE_STATUSES, createRelease, listReleases, type Release } from '$lib/api/content-releases';

export const load: PageServerLoad = async (event) => {
	const { plugins } = await event.parent();
	const { limit, offset } = pageWindow(event.url, 50, 200);
	const raw = event.url.searchParams.get('status') ?? '';
	const status = (RELEASE_STATUSES as readonly string[]).includes(raw) ? raw : '';

	let releases: Release[] = [];
	let total = 0;
	let gate: Gate = notRunning(plugins, PLUGIN.content) ? { state: 'absent' } : GATE_OK;
	if (gate.state === 'ok') {
		try {
			const res = await listReleases(authedClient(event), status, limit, offset);
			releases = rowsOf(res);
			total = Math.max(totalOf(res), offset + releases.length);
		} catch (err) {
			gate = gateOf(err, 'Releases could not be read. This is not a report that there are none.');
		}
	}
	return { releases, total, limit, offset, status, gate };
};

export const actions: Actions = {
	create: async (event) => {
		await requireUser(event);
		const form = await event.request.formData();
		const name = String(form.get('name') ?? '').trim();
		const description = String(form.get('description') ?? '').trim();
		if (!name) {
			return fail(400, { error: 'Check the highlighted fields.', fields: { name: 'Name is required' } });
		}
		let created: Release;
		try {
			created = await createRelease(authedClient(event), { name, description });
		} catch (err) {
			return actionFailure(err, 'The release could not be created.');
		}
		redirect(303, `/admin/releases/${created.id}`);
	},
};
