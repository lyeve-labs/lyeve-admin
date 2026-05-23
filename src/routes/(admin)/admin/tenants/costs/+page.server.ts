import type { PageServerLoad, Actions } from './$types';
import { error, fail } from '@sveltejs/kit';
import { ApiError } from '@lyeve-labs/client';
import { authedClient, requireRole } from '$lib/server/authz';
import { actionError } from '$lib/server/action-error';
import { gateOf } from '$lib/api/gate';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning } from '$lib/plugins';
import {
	aggregateNow,
	createBudget,
	deleteBudget,
	deletePrice,
	getDashboard,
	getSummary,
	isResourceType,
	listBudgets,
	listPrices,
	putPrice,
	type Budget,
	type CostDashboard,
	type CostSummary,
	type Price,
	monthStart,
} from '$lib/api/cost';
import { parseBudget, parsePrice } from '$lib/cost/forms';

const OPERATOR_ROLES = ['admin', 'super_admin'];

/**
 * What the page renders. When the ledger's routes refuse this instance, every
 * read is null and the page shows only that the feature is not enabled, with
 * the link the refusal names. Otherwise a read the engine did not answer is
 * null on its own and the page says so in place.
 */
export type CostsPage = {
	enabled: boolean;
	/** Where the ledger is turned on, when a refusal names it. */
	upgradeUrl: string;
	summary: CostSummary | null;
	dashboard: CostDashboard | null;
	budgets: Budget[] | null;
	prices: Price[] | null;
};

export const load: PageServerLoad = async (event) => {
	const { user, plugins } = await event.parent();
	if (!user.roles.some((role) => OPERATOR_ROLES.includes(role))) {
		error(403, 'Requires admin or super_admin role');
	}
	const page: CostsPage = {
		enabled: true,
		upgradeUrl: '',
		summary: null,
		dashboard: null,
		budgets: null,
		prices: null,
	};
	// The shell says why the page is unavailable while its plugin does not run.
	if (notRunning(plugins, PLUGIN.multitenant)) return page;

	// The ledger's routes answer 402 on an instance that is not enabled for
	// them. The page renders that answer rather than predicting it.
	const refused = { upgradeUrl: null as string | null };
	const read = <T>(pending: Promise<T>): Promise<T | null> =>
		pending.catch((err: unknown) => {
			const gate = gateOf(err, '');
			if (gate.state === 'locked') refused.upgradeUrl = gate.upgradeUrl;
			return null;
		});
	const client = authedClient(event);
	const [summary, dashboard, budgets, prices] = await Promise.all([
		read(getSummary(client, monthStart(new Date()))),
		read(getDashboard(client)),
		read(listBudgets(client)),
		read(listPrices(client)),
	]);
	if (refused.upgradeUrl !== null) return { ...page, enabled: false, upgradeUrl: refused.upgradeUrl };
	return { ...page, summary, dashboard, budgets, prices };
};

/** A refused write: a 402 means the ledger is not enabled, and is said as such. */
function refusal(form: string, err: unknown, fallback: string) {
	if (err instanceof ApiError && err.status === 402) {
		return fail(402, { form, error: 'The cost ledger is not enabled on this instance.', locked: true });
	}
	return fail(400, { form, error: actionError(err, fallback), locked: false });
}

export const actions: Actions = {
	createBudget: async (event) => {
		await requireRole(event, OPERATOR_ROLES);
		const parsed = parseBudget(await event.request.formData());
		if ('error' in parsed) return fail(400, { form: 'budget', error: parsed.error, locked: false });
		try {
			await createBudget(authedClient(event), parsed.budget);
		} catch (err) {
			return refusal('budget', err, 'Failed to create the budget.');
		}
		return { form: 'budget', saved: true };
	},

	deleteBudget: async (event) => {
		await requireRole(event, OPERATOR_ROLES);
		const form = await event.request.formData();
		const id = String(form.get('id') ?? '').trim();
		if (!id) return fail(400, { form: 'budget', error: 'Pick a budget to delete.', locked: false });
		try {
			await deleteBudget(authedClient(event), id);
		} catch (err) {
			return refusal('budget', err, 'Failed to delete the budget.');
		}
		return { form: 'budget', saved: true };
	},

	putPrice: async (event) => {
		await requireRole(event, OPERATOR_ROLES);
		const parsed = parsePrice(await event.request.formData());
		if ('error' in parsed) return fail(400, { form: 'price', error: parsed.error, locked: false });
		try {
			await putPrice(authedClient(event), parsed.resourceType, parsed.price);
		} catch (err) {
			return refusal('price', err, 'Failed to save the price.');
		}
		return { form: 'price', saved: true };
	},

	resetPrice: async (event) => {
		await requireRole(event, OPERATOR_ROLES);
		const form = await event.request.formData();
		const resourceType = form.get('resource_type');
		if (!isResourceType(resourceType)) {
			return fail(400, { form: 'price', error: 'Pick a resource type.', locked: false });
		}
		try {
			await deletePrice(authedClient(event), resourceType);
		} catch (err) {
			return refusal('price', err, 'Failed to reset the price.');
		}
		return { form: 'price', saved: true };
	},

	aggregate: async (event) => {
		await requireRole(event, OPERATOR_ROLES);
		try {
			const result = await aggregateNow(authedClient(event));
			return { form: 'aggregate', saved: true, result };
		} catch (err) {
			return refusal('aggregate', err, 'The feed did not run.');
		}
	},
};
