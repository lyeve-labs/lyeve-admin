import type { PageServerLoad, Actions } from './$types';
import { fail } from '@sveltejs/kit';
import { authedClient } from '$lib/server/authz';
import { actionError } from '$lib/server/action-error';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning } from '$lib/plugins';
import {
	DEVICES_OK,
	deviceGate,
	listDevices,
	trustThisDevice,
	untrustDevice,
	type Device,
	type DeviceGate,
} from '$lib/api/devices';
import { pageOf, pageWindow } from '$lib/api/list';

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

export const load: PageServerLoad = async (event) => {
	const { plugins } = await event.parent();
	const { limit, offset } = pageWindow(event.url, DEFAULT_LIMIT, MAX_LIMIT);

	// The browser reading the page, so a row can be marked as probably this
	// one. It is passed through rather than read in the component because a
	// component that reads navigator renders differently on the server.
	const userAgent = event.request.headers.get('user-agent');

	// The shell says why the page is unavailable while its plugin does not run.
	if (notRunning(plugins, PLUGIN.deviceFingerprint)) {
		return {
			devices: [] as Device[],
			total: null as number | null,
			limit,
			offset,
			hasMore: false,
			userAgent,
			gate: { state: 'absent' } as DeviceGate,
		};
	}

	const client = authedClient(event);
	let devices: Device[] = [];
	let total: number | null = null;
	let hasMore = false;
	let gate: DeviceGate = DEVICES_OK;
	try {
		const page = pageOf(await listDevices(client, limit + 1, offset), limit, offset);
		devices = page.rows;
		total = page.total;
		hasMore = page.hasMore;
	} catch (err) {
		gate = deviceGate(err);
	}

	return { devices, total, limit, offset, hasMore, userAgent, gate };
};

// No requireRole here, and deliberately. Every route behind this page reads the
// user out of the session claims, so it is already scoped to whoever is asking:
// a role check would only stop somebody managing their own devices.
export const actions: Actions = {
	trust: async (event) => {
		const client = authedClient(event);
		const form = await event.request.formData();
		const label = String(form.get('label') ?? '').trim();
		if (!label) {
			return fail(400, { error: 'Name this device, or you will not know which one it was.' });
		}
		try {
			await trustThisDevice(client, label);
		} catch (err) {
			return fail(400, { error: actionError(err, 'This device could not be trusted.') });
		}
		return { trusted: label };
	},

	untrust: async (event) => {
		const client = authedClient(event);
		const form = await event.request.formData();
		const id = String(form.get('id') ?? '');
		if (!id) return fail(400, { error: 'No device was named.' });
		try {
			await untrustDevice(client, id);
		} catch (err) {
			return fail(400, { error: actionError(err, 'The device could not be removed.') });
		}
		return { removed: id };
	},
};
