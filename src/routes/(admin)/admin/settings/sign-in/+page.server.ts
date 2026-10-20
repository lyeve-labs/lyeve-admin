import type { Actions, PageServerLoad } from './$types';
import { fail } from '@sveltejs/kit';
import { authedClient, requireRole } from '$lib/server/authz';
import { actionFailure } from '$lib/server/action-error';
import { GATE_OK, type Gate } from '$lib/api/gate';
import {
	PROVIDER_WINDOW_MAX_DAYS,
	parseWindowDays,
	providerWindowGate,
	readProviderWindow,
	saveProviderWindow,
	type ProviderWindow,
} from '$lib/api/provider-window';

export const load: PageServerLoad = async (event) => {
	try {
		return { gate: GATE_OK as Gate, window: await readProviderWindow(authedClient(event)) };
	} catch (err) {
		return { gate: providerWindowGate(err), window: null as ProviderWindow | null };
	}
};

export const actions: Actions = {
	save: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		const form = await event.request.formData();
		const raw = String(form.get('days') ?? '');
		const days = parseWindowDays(raw);
		if (days === null) {
			return fail(400, { error: `Enter a whole number of days from 0 to ${PROVIDER_WINDOW_MAX_DAYS}.`, days: raw });
		}
		try {
			const saved = await saveProviderWindow(authedClient(event), days);
			return { saved: true, days: String(saved.days) };
		} catch (err) {
			return actionFailure(err, 'The sign-in window could not be saved.');
		}
	},
};
