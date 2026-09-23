// @vitest-environment jsdom
import { render, cleanup } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy: () => {} }) }));

import DetailPage from './+page.svelte';
import type { Experiment, ExperimentResults, Metric, Variant } from '$lib/api/ab-testing';

afterEach(cleanup);

function said(c: HTMLElement): string {
	return (c.textContent ?? '').replace(/\s+/g, ' ');
}

function experiment(over: Partial<Experiment> = {}): Experiment {
	return {
		id: 'e1',
		tenant_id: 'default',
		name: 'Checkout button',
		description: 'Does a brighter button get more checkouts',
		status: 'running',
		traffic_split: {},
		auto_stop_enabled: false,
		significance_threshold: 0.95,
		min_sample_size: 100,
		created_at: '2026-09-01T00:00:00Z',
		updated_at: '2026-09-01T00:00:00Z',
		...over,
	};
}

function variant(over: Partial<Variant> = {}): Variant {
	return {
		id: 'v1',
		experiment_id: 'e1',
		name: 'control',
		config: '',
		traffic_percentage: 50,
		is_control: true,
		created_at: '2026-09-01T00:00:00Z',
		...over,
	};
}

function metric(over: Partial<Metric> = {}): Metric {
	return {
		id: 'm1',
		experiment_id: 'e1',
		name: 'Checkout completed',
		event_name: 'checkout.completed',
		metric_type: 'conversion',
		created_at: '2026-09-01T00:00:00Z',
		...over,
	};
}

function results(over: Partial<ExperimentResults> = {}): ExperimentResults {
	return {
		experiment_id: 'e1',
		status: 'running',
		variants: [
			{ variant_id: 'v1', variant_name: 'control', is_control: true, sample_size: 500, conversions: 50, conversion_rate: 0.1 },
			{ variant_id: 'v2', variant_name: 'bright', is_control: false, sample_size: 500, conversions: 75, conversion_rate: 0.15, p_value: 0.004 },
		],
		significant: true,
		winner: 'bright',
		sample_sizes: { control: 500, bright: 500 },
		...over,
	};
}

const props = (over: Record<string, unknown> = {}, form: unknown = null) => ({
	data: {
		experiment: experiment(),
		variants: [variant(), variant({ id: 'v2', name: 'bright', is_control: false })],
		metrics: [metric()],
		results: results(),
		gate: { state: 'ok' },
		...over,
	} as never,
	form: form as never,
});

describe('the verdict', () => {
	it('names the leader when the engine called it significant', () => {
		const { container } = render(DetailPage, { props: props() });
		const text = said(container);
		expect(text).toContain('bright is ahead');
		expect(text).toContain('unlikely to be chance');
	});

	// The reading this whole page exists to prevent.
	it('refuses to present an inconclusive result as a tie', () => {
		const { container } = render(DetailPage, {
			props: props({ results: results({ significant: false, winner: null }) }),
		});
		const text = said(container);
		expect(text).toContain('Not conclusive yet');
		expect(text).toContain('not a tie');
		expect(text).not.toContain('Ahead');
	});

	it('warns when a variant is below the minimum the experiment set itself', () => {
		const thin = results({
			variants: [
				{ variant_id: 'v1', variant_name: 'control', is_control: true, sample_size: 500, conversions: 50, conversion_rate: 0.1 },
				{ variant_id: 'v2', variant_name: 'bright', is_control: false, sample_size: 9, conversions: 4, conversion_rate: 0.44 },
			],
		});
		const { container } = render(DetailPage, { props: props({ results: thin }) });
		expect(said(container)).toContain('not yet worth acting on');
	});
});

describe('the traffic split', () => {
	// Nothing in the engine reconciles the per-variant percentages, so a split
	// that does not add up is storable and means whatever bucketing does.
	it('says when the shares do not come to a hundred', () => {
		const { container } = render(DetailPage, {
			props: props({
				variants: [variant({ traffic_percentage: 60 }), variant({ id: 'v2', name: 'bright', traffic_percentage: 60 })],
			}),
		});
		expect(said(container)).toContain('add up to 120%');
	});

	it('says nothing when they do', () => {
		const { container } = render(DetailPage, { props: props() });
		expect(said(container)).not.toContain('add up to');
	});
});

describe('the empty states', () => {
	it('says an experiment with no variants splits nothing', () => {
		const { container } = render(DetailPage, { props: props({ variants: [] }) });
		expect(said(container)).toContain('splits nothing');
	});

	it('says an experiment with no metric can never produce a result', () => {
		const { container } = render(DetailPage, { props: props({ metrics: [] }) });
		expect(said(container)).toContain('can never produce a result');
	});

	it('says there is no result yet rather than reporting one', () => {
		const { container } = render(DetailPage, { props: props({ results: null }) });
		expect(said(container)).toContain('No results yet');
	});
});
