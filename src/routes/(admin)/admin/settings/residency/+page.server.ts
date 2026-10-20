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
import { GATE_OK, section, type Gate } from '$lib/api/gate';

/** The most regions the page lists. An instance runs in a handful. */
const REGION_CAP = 100;

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
			more: false,
			report: null as ResidencyReport | null,
			reportGate: GATE_OK as Gate,
			gate: (absent ? { state: 'absent' } : RESIDENCY_OK) as ResidencyGate,
			permitted,
		};
	}

	const client = authedClient(event);
	let regions: Region[] = [];
	let gate: ResidencyGate = RESIDENCY_OK;
	// One row past the cap says whether the list was cut.
	let more = false;
	try {
		const rows = rowsOf(await listRegions(client, REGION_CAP + 1, 0));
		more = rows.length > REGION_CAP;
		regions = rows.slice(0, REGION_CAP);
	} catch (err) {
		gate = residencyGate(err);
	}

	// The report is the evidence half of this page. An unread report is never
	// rendered as an empty one: a page that shows no unassigned tenants
	// because it could not ask is the worst answer here.
	// The gate says why it is unread, so a role refusal or an outage is not
	// shown as the same failure.
	const report =
		gate.state === 'ok'
			? await section(
					readReport(client),
					'The residency report could not be read. This is not a report that every tenant is placed.',
				)
			: null;

	return {
		regions,
		more,
		report: report?.ok ? report.value : null,
		reportGate: report && !report.ok ? report.gate : GATE_OK,
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
				action: 'create',
				error: 'A region slug is lower case letters, digits and hyphens, starting with a letter. It is copied onto every assignment, so it cannot be renamed later.',
			});
		}
		if (!displayName) return fail(400, { action: 'create', error: 'Give the region a name a person can read.' });
		if (!provider) return fail(400, { action: 'create', error: 'Name who runs it: aws, gcp, azure, on-prem.' });

		// The plugin's create takes no enabled field, refuses a body that
		// names one, and opens every new region. A region asked for closed is
		// created, then closed by an update.
		let created: Region;
		try {
			created = await createRegion(client, {
				slug,
				display_name: displayName,
				provider,
				coordinates: coordinates(form),
				is_default: form.get('is_default') === 'true',
			});
		} catch (err) {
			return fail(400, { action: 'create', error: actionError(err, 'The region could not be created.') });
		}
		if (form.get('enabled') !== 'true') {
			try {
				await updateRegion(client, created.id, { enabled: false });
			} catch {
				return fail(400, {
					action: 'close',
					error: `Region ${displayName} was created but could not be closed, so it is listed to clients, used for nearest-region routing and still takes new tenants. Edit it and turn off Accepting new tenants.`,
				});
			}
		}
		return { saved: slug };
	},

	update: async (event) => {
		await requireRole(event, ['super_admin']);
		const client = authedClient(event);
		const form = await event.request.formData();
		const id = String(form.get('id') ?? '');
		if (!id) return fail(400, { action: 'update', error: 'No region was named.' });

		const displayName = String(form.get('display_name') ?? '').trim();
		const provider = String(form.get('provider') ?? '').trim();
		if (!displayName) return fail(400, { action: 'update', error: 'Give the region a name a person can read.' });

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
			return fail(400, { action: 'update', error: actionError(err, 'The region could not be saved.') });
		}
		return { saved: displayName };
	},

	delete: async (event) => {
		await requireRole(event, ['super_admin']);
		const client = authedClient(event);
		const form = await event.request.formData();
		const id = String(form.get('id') ?? '');
		if (!id) return fail(400, { action: 'delete', error: 'No region was named.' });
		try {
			await deleteRegion(client, id);
		} catch (err) {
			return fail(400, { action: 'delete', error: actionError(err, 'The region could not be removed.') });
		}
		return { removed: id };
	},
};
