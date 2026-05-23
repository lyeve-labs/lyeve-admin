import type { PageServerLoad, Actions } from './$types';
import { fail } from '@sveltejs/kit';
import { authedClient, requireRole } from '$lib/server/authz';
import { actionFailure } from '$lib/server/action-error';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning } from '$lib/plugins';
import { gateOf, GATE_OK, type Gate } from '$lib/api/gate';
import { errorCodeOf } from '$lib/api/limits';
import {
	ADDRESS_DUPLICATE,
	ADDRESS_LIST_FULL,
	ADDRESS_SELF_LOCKOUT,
	HISTORY_WINDOWS,
	cidrIsSound,
	clearTenantGlobal,
	createAddressEntry,
	deleteAddressEntry,
	listAddressEntries,
	readRefusalHistory,
	readTenantGlobal,
	setTenantGlobal,
	type AddressListRead,
	type RefusalHistory,
	type TenantGlobalRead,
} from '$lib/api/rate-limit';

/** A read of its own, so one refused section never takes the others with it. */
interface Section<T> {
	gate: Gate;
	value: T | null;
}

async function section<T>(read: () => Promise<T>, failed: string): Promise<Section<T>> {
	try {
		return { gate: GATE_OK, value: await read() };
	} catch (err) {
		return { gate: gateOf(err, failed), value: null };
	}
}

function windowOf(url: URL): number {
	const raw = url.searchParams.get('hours') ?? '24';
	return HISTORY_WINDOWS.some((w) => w.value === raw) ? Number(raw) : 24;
}

export const load: PageServerLoad = async (event) => {
	const { plugins } = await event.parent();
	const hours = windowOf(event.url);
	if (notRunning(plugins, PLUGIN.rateLimit)) {
		const absent = { gate: { state: 'absent' } as Gate, value: null };
		return { gate: absent.gate, limit: absent, addresses: absent, history: absent, hours };
	}

	const client = authedClient(event);
	const [limit, addresses, history] = await Promise.all([
		section<TenantGlobalRead>(
			() => readTenantGlobal(client),
			'The tenant limit could not be read. This is not a report that none is set.',
		),
		section<AddressListRead>(
			() => listAddressEntries(client),
			'The address lists could not be read. This is not a report that they are empty.',
		),
		section<RefusalHistory>(
			() => readRefusalHistory(client, hours),
			'The refusal history could not be read. This is not a report that nothing was refused.',
		),
	]);

	return { gate: GATE_OK as Gate, limit, addresses, history, hours };
};

function num(raw: FormDataEntryValue | null): number {
	const n = Number(raw);
	return Number.isFinite(n) ? n : Number.NaN;
}

export const actions: Actions = {
	setLimit: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		const form = await event.request.formData();
		const rate = num(form.get('rate'));
		const burst = Math.floor(num(form.get('burst')));
		if (!Number.isFinite(rate) || rate <= 0) {
			return fail(400, { error: 'The rate is requests per second and must be more than zero.' });
		}
		if (!Number.isFinite(burst) || burst < 1) {
			return fail(400, { error: 'The burst must be at least one request.' });
		}
		try {
			await setTenantGlobal(authedClient(event), { rate, burst, enabled: form.get('enabled') === 'true' });
		} catch (err) {
			return actionFailure(err, 'The tenant limit could not be saved.');
		}
		return { savedLimit: true };
	},

	// Clearing puts the tenant back on the install-wide limit, and is always allowed.
	clearLimit: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		try {
			await clearTenantGlobal(authedClient(event));
		} catch (err) {
			return actionFailure(err, 'The tenant limit could not be cleared.');
		}
		return { clearedLimit: true };
	},

	addAddress: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		const form = await event.request.formData();
		const cidr = String(form.get('cidr') ?? '').trim();
		const list = form.get('list') === 'deny' ? 'deny' : 'allow';
		const note = String(form.get('note') ?? '').trim();
		if (!cidrIsSound(cidr)) {
			return fail(400, { error: 'Enter one address, such as 203.0.113.7, or a range, such as 203.0.113.0/24 or 2001:db8::/32.' });
		}
		if (note.length > 255) return fail(400, { error: 'A note is at most 255 characters.' });
		try {
			await createAddressEntry(authedClient(event), { cidr, list, note });
		} catch (err) {
			// Three refusals share 409, so the page reads the plugin's code. A
			// deny entry that would shut out the address the request came from
			// is refused because only an operator could undo it, and the page
			// says why and how to proceed rather than relaying a bare 409.
			switch (errorCodeOf(err)) {
				case ADDRESS_SELF_LOCKOUT:
					return fail(409, { error: 'That entry would lock you out.', lockout: cidr });
				case ADDRESS_LIST_FULL:
					return fail(409, {
						error: 'This tenant holds as many address entries as it may. Remove one before adding another.',
						listFull: true,
					});
				case ADDRESS_DUPLICATE:
					return fail(409, { error: `${cidr} is already on the ${list} list.`, duplicate: cidr });
			}
			return actionFailure(err, 'The address could not be added.');
		}
		return { savedAddress: cidr, list };
	},

	deleteAddress: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		const form = await event.request.formData();
		const id = String(form.get('id') ?? '').trim();
		if (!id) return fail(400, { error: 'No entry was named.' });
		try {
			await deleteAddressEntry(authedClient(event), id);
		} catch (err) {
			return actionFailure(err, 'The entry could not be removed.');
		}
		return { removedAddress: id };
	},
};
