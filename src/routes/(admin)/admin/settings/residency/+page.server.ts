import type { PageServerLoad, Actions } from './$types';
import { fail } from '@sveltejs/kit';
import { authedClient, requireRole } from '$lib/server/authz';
import { actionError } from '$lib/server/action-error';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning } from '$lib/plugins';
import {
	RESIDENCY_OK,
	createRegion,
	deleteRegion,
	listRegions,
	readReport,
	residencyGate,
	slugIsSound,
	updateRegion,
	type Region,
	type ResidencyGate,
	type ResidencyReport,
} from '$lib/api/residency';
import { rowsOf } from '$lib/api/list';

export const load: PageServerLoad = async (event) => {
	const { plugins, user } = await event.parent();
	// Regions and the report are both super admin routes, so anybody else is
	// told rather than shown two failed reads they cannot act on.
	const permitted = user.roles.includes('super_admin');

	// The shell says why the page is unavailable while its plugin does not run.
	const absent = notRunning(plugins, PLUGIN.dataResidency);
	if (absent || !permitted) {
		return {
			regions: [] as Region[],
			report: null as ResidencyReport | null,
			reportRead: false,
			gate: (absent ? { state: 'absent' } : RESIDENCY_OK) as ResidencyGate,
			permitted,
		};
	}

	const client = authedClient(event);
	let regions: Region[] = [];
	let gate: ResidencyGate = RESIDENCY_OK;
	try {
		regions = rowsOf(await listRegions(client, 100, 0));
	} catch (err) {
		gate = residencyGate(err);
	}

	// The report is the evidence half of this page. An unread report is never
	// rendered as an empty one: a page that shows no unassigned tenants
	// because it could not ask is the worst answer here.
	const report =
		gate.state === 'ok'
			? await readReport(client)
					.then((r) => ({ value: r, read: true }))
					.catch(() => ({ value: null as ResidencyReport | null, read: false }))
			: { value: null as ResidencyReport | null, read: false };

	return {
		regions,
		report: report.value,
		reportRead: report.read,
		gate,
		permitted,
	};
};

function coordinates(form: FormData): { lat: number; long: number } | undefined {
	const lat = Number(form.get('lat'));
	const long = Number(form.get('long'));
	if (!Number.isFinite(lat) || !Number.isFinite(long)) return undefined;
	if (lat === 0 && long === 0) return undefined;
	return { lat, long };
}

export const actions: Actions = {
	create: async (event) => {
		await requireRole(event, ['super_admin']);
		const client = authedClient(event);
		const form = await event.request.formData();

		const slug = String(form.get('slug') ?? '').trim();
		const displayName = String(form.get('display_name') ?? '').trim();
		const provider = String(form.get('provider') ?? '').trim();

		if (!slugIsSound(slug)) {
			return fail(400, {
				error: 'A region slug is lower case letters, digits and hyphens, starting with a letter. It is copied onto every assignment, so it cannot be renamed later.',
			});
		}
		if (!displayName) return fail(400, { error: 'Give the region a name a person can read.' });
		if (!provider) return fail(400, { error: 'Name who runs it: aws, gcp, azure, on-prem.' });

		try {
			await createRegion(client, {
				slug,
				display_name: displayName,
				provider,
				coordinates: coordinates(form),
				enabled: form.get('enabled') === 'true',
				is_default: form.get('is_default') === 'true',
			});
		} catch (err) {
			return fail(400, { error: actionError(err, 'The region could not be created.') });
		}
		return { saved: slug };
	},

	update: async (event) => {
		await requireRole(event, ['super_admin']);
		const client = authedClient(event);
		const form = await event.request.formData();
		const id = String(form.get('id') ?? '');
		if (!id) return fail(400, { error: 'No region was named.' });

		const displayName = String(form.get('display_name') ?? '').trim();
		const provider = String(form.get('provider') ?? '').trim();
		if (!displayName) return fail(400, { error: 'Give the region a name a person can read.' });

		// The slug is deliberately not sent. It is denormalized onto every
		// tenant assignment and onto the report, so changing it here would
		// leave those rows naming a region that no longer exists.
		try {
			await updateRegion(client, id, {
				display_name: displayName,
				provider,
				coordinates: coordinates(form),
				enabled: form.get('enabled') === 'true',
				is_default: form.get('is_default') === 'true',
			});
		} catch (err) {
			return fail(400, { error: actionError(err, 'The region could not be saved.') });
		}
		return { saved: displayName };
	},

	delete: async (event) => {
		await requireRole(event, ['super_admin']);
		const client = authedClient(event);
		const form = await event.request.formData();
		const id = String(form.get('id') ?? '');
		if (!id) return fail(400, { error: 'No region was named.' });
		try {
			await deleteRegion(client, id);
		} catch (err) {
			return fail(400, { error: actionError(err, 'The region could not be removed.') });
		}
		return { removed: id };
	},
};
