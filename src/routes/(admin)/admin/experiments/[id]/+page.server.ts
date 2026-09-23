import type { PageServerLoad, Actions } from './$types';
import { error, fail } from '@sveltejs/kit';
import { authedClient, requireRole } from '$lib/server/authz';
import { actionError } from '$lib/server/action-error';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning } from '$lib/plugins';
import { ApiError } from '@lyeve-labs/client';
import {
	AB_OK,
	EXPERIMENTS_URL,
	METRIC_TYPES,
	abGate,
	createMetric,
	createVariant,
	deleteMetric,
	deleteVariant,
	listMetrics,
	listVariants,
	readResults,
	type AbGate,
	type Experiment,
	type ExperimentResults,
	type Metric,
	type MetricType,
	type Variant,
} from '$lib/api/ab-testing';

function metricType(value: string): MetricType | null {
	return METRIC_TYPES.includes(value as MetricType) ? (value as MetricType) : null;
}

export const load: PageServerLoad = async (event) => {
	const { plugins } = await event.parent();
	// The shell says why the page is unavailable while its plugin does not run.
	if (notRunning(plugins, PLUGIN.abTesting)) error(404, 'No such experiment');

	const client = authedClient(event);
	const id = event.params.id;

	let experiment: Experiment;
	try {
		experiment = await client.get<Experiment>(`${EXPERIMENTS_URL}/${encodeURIComponent(id)}`);
	} catch (err) {
		if (err instanceof ApiError && err.status === 404) error(404, 'No such experiment');
		error(503, 'The experiment could not be read');
	}

	// Each panel is read on its own so one failure does not empty the page.
	// Results in particular fail on an experiment nobody has been exposed to
	// yet, which is not an error worth losing the variants over.
	const [variants, metrics, results] = await Promise.all([
		listVariants(client, id).catch((): Variant[] => []),
		listMetrics(client, id).catch((): Metric[] => []),
		readResults(client, id).catch((): ExperimentResults | null => null),
	]);

	const gate: AbGate = AB_OK;
	return { experiment, variants: variants ?? [], metrics: metrics ?? [], results, gate };
};

export const actions: Actions = {
	addVariant: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		const client = authedClient(event);
		const form = await event.request.formData();

		const name = String(form.get('name') ?? '').trim();
		if (!name) return fail(400, { error: 'Name the variant. It is what a result is reported against.' });

		const share = Number(form.get('traffic_percentage'));
		if (!Number.isFinite(share) || share <= 0 || share > 100) {
			return fail(400, { error: 'A variant takes a share of traffic above 0 and no more than 100.' });
		}

		try {
			await createVariant(client, event.params.id, {
				name,
				description: String(form.get('description') ?? '').trim() || undefined,
				config: String(form.get('config') ?? '').trim() || undefined,
				traffic_percentage: share,
				is_control: form.get('is_control') === 'true',
			});
		} catch (err) {
			return fail(400, { error: actionError(err, 'The variant could not be added.') });
		}
		return { saved: name };
	},

	removeVariant: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		const client = authedClient(event);
		const form = await event.request.formData();
		const vid = String(form.get('vid') ?? '');
		if (!vid) return fail(400, { error: 'No variant was named.' });
		try {
			await deleteVariant(client, event.params.id, vid);
		} catch (err) {
			return fail(400, { error: actionError(err, 'The variant could not be removed.') });
		}
		return { removed: vid };
	},

	addMetric: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		const client = authedClient(event);
		const form = await event.request.formData();

		const name = String(form.get('name') ?? '').trim();
		const eventName = String(form.get('event_name') ?? '').trim();
		const kind = metricType(String(form.get('metric_type') ?? ''));
		if (!name) return fail(400, { error: 'Name the metric.' });
		if (!eventName) {
			return fail(400, {
				error: 'Name the event this metric counts, or nothing the application sends will match it.',
			});
		}
		if (!kind) return fail(400, { error: 'Choose a metric type.' });

		try {
			await createMetric(client, event.params.id, {
				name,
				description: String(form.get('description') ?? '').trim() || undefined,
				event_name: eventName,
				metric_type: kind,
			});
		} catch (err) {
			return fail(400, { error: actionError(err, 'The metric could not be added.') });
		}
		return { saved: name };
	},

	removeMetric: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		const client = authedClient(event);
		const form = await event.request.formData();
		const mid = String(form.get('mid') ?? '');
		if (!mid) return fail(400, { error: 'No metric was named.' });
		try {
			await deleteMetric(client, event.params.id, mid);
		} catch (err) {
			return fail(400, { error: actionError(err, 'The metric could not be removed.') });
		}
		return { removed: mid };
	},
};
