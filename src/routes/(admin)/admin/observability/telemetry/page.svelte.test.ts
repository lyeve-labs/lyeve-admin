// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/navigation', () => ({ goto: vi.fn(async () => {}), invalidateAll: vi.fn(async () => {}) }));
vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));

import TelemetryPage from './+page.svelte';
import type { MetricFamily } from '$lib/api/telemetry';

const REQUESTS: MetricFamily = {
	name: 'lyeve_requests_total',
	help: 'Requests served.',
	type: 'counter',
	samples: [{ labels: { code: '2xx', method: 'GET', plugin: 'core', tenant: 'acme' }, value: 12 }],
};

const POOL: MetricFamily = {
	name: 'lyeve_db_pool_max_connections',
	help: 'Maximum open connections.',
	type: 'gauge',
	samples: [{ labels: {}, value: 25 }],
};

const EXPORTERS = [
	{ name: 'pushgateway', healthy: true, last_export: '2026-09-21T10:00:00Z', exports: 4, failures: 0 },
	{ name: 'otlp', healthy: false, last_error: 'dial refused', exports: 1, failures: 3 },
];

/** A status report whose telemetry row names the given maturity in its manifest. */
function statusSaying(maturity: string | undefined) {
	return {
		compiled: ['telemetry'],
		entitled: ['telemetry'],
		plugins: [
			{
				name: 'telemetry',
				compiled: true,
				entitled: true,
				requested: true,
				active: true,
				phase: 'running',
				manifest: { label: 'Telemetry', category: 'platform', ...(maturity ? { maturity } : {}) },
			},
		],
	};
}

function props(data: Record<string, unknown>, form: Record<string, unknown> | null = null) {
	return { data: data as never, form: form as never };
}

afterEach(cleanup);

describe('the role split', () => {
	// The exporters are the instance's export configuration. A tenant admin's
	// page carries no such section and no export control at all, rather than
	// an empty table or a disabled button.
	it('shows a tenant admin the metrics view only', () => {
		const { container, queryByTestId, queryByRole } = render(TelemetryPage, props({ superAdmin: false, families: [REQUESTS], exporters: null }));
		expect(queryByTestId('telemetry-metrics')).not.toBeNull();
		expect(queryByTestId('telemetry-exporters')).toBeNull();
		expect(queryByRole('button', { name: /Export .* now/ })).toBeNull();
		expect(container.textContent).toContain('Only the series carrying your tenant label');
		expect(container.textContent).toContain('{code="2xx",method="GET",plugin="core",tenant="acme"}');
		expect(container.textContent).not.toContain('Exporters');
	});

	it('shows a super admin the registry and the exporters with an export control per row', () => {
		const { container, queryByTestId, getAllByRole } = render(TelemetryPage, props({ superAdmin: true, families: [POOL, REQUESTS], exporters: EXPORTERS }));
		expect(queryByTestId('telemetry-metrics')).not.toBeNull();
		expect(queryByTestId('telemetry-exporters')).not.toBeNull();
		expect(getAllByRole('button', { name: /Export .* now/ })).toHaveLength(2);
		expect(container.textContent).toContain('Whole registry');
		expect(container.textContent).toContain('lyeve_db_pool_max_connections');
		expect(container.textContent).toContain('Healthy');
		expect(container.textContent).toContain('Unhealthy');
		expect(container.textContent).toContain('dial refused');
	});

	it('wears the Beta badge the plugin asks for, with the gaps named', () => {
		const { container } = render(
			TelemetryPage,
			props({ superAdmin: false, families: [REQUESTS], exporters: null, pluginStatus: statusSaying('beta') }),
		);
		expect(container.textContent).toContain('Beta');
		expect(container.textContent).toContain('one exporter set');
		expect(container.textContent).toContain('tenant slug');
	});

	it('leaves the badge off when the plugin does not say it is beta', () => {
		for (const pluginStatus of [statusSaying('stable'), statusSaying(undefined), null]) {
			const { container } = render(
				TelemetryPage,
				props({ superAdmin: false, families: [REQUESTS], exporters: null, pluginStatus }),
			);
			expect(container.textContent).not.toContain('Beta');
			cleanup();
		}
	});
});

describe('the metrics view', () => {
	it('says the scrape was refused rather than showing an empty registry', () => {
		const { container } = render(TelemetryPage, props({ superAdmin: false, families: null, exporters: null }));
		expect(container.textContent).toContain('Metrics unavailable');
		expect(container.textContent).not.toContain('No series yet');
	});

	it('tells a tenant admin with no series that none has been recorded under their tenant', () => {
		const { container } = render(TelemetryPage, props({ superAdmin: false, families: [], exporters: null }));
		expect(container.textContent).toContain('under your tenant');
	});

	it('filters the families by the search', async () => {
		const { container, getByRole } = render(TelemetryPage, props({ superAdmin: true, families: [POOL, REQUESTS], exporters: [] }));
		const search = getByRole('searchbox', { name: 'Filter families' });
		await fireEvent.input(search, { target: { value: 'pool' } });
		await tick();
		expect(container.textContent).toContain('lyeve_db_pool_max_connections');
		expect(container.textContent).not.toContain('lyeve_requests_total');
		expect(container.textContent).toContain('1 of 2 families');
	});

	it('folds a long family and opens it on demand', async () => {
		const wide: MetricFamily = {
			name: 'lyeve_request_duration_seconds',
			help: '',
			type: 'histogram',
			samples: Array.from({ length: 15 }, (_, i) => ({ labels: { le: String(i), __series: 'bucket' }, value: i })),
		};
		const { container, getByRole } = render(TelemetryPage, props({ superAdmin: true, families: [wide], exporters: [] }));
		expect(container.querySelectorAll('tbody tr')).toHaveLength(12);
		await fireEvent.click(getByRole('button', { name: 'Show all 15' }));
		await tick();
		expect(container.querySelectorAll('tbody tr')).toHaveLength(15);
		expect(container.textContent).toContain('lyeve_request_duration_seconds_bucket{le="14"}');
	});
});

describe('the exporters section', () => {
	it('relays the cooldown on the form that asked', () => {
		const { container } = render(
			TelemetryPage,
			props({ superAdmin: true, families: [], exporters: EXPORTERS }, { name: 'otlp', error: 'otlp exported a moment ago. Wait five seconds and try again.' }),
		);
		expect(container.textContent).toContain('Wait five seconds');
	});

	it('says no exporter is configured rather than rendering an empty table', () => {
		const { container } = render(TelemetryPage, props({ superAdmin: true, families: [], exporters: [] }));
		expect(container.textContent).toContain('No exporter configured');
	});

	it('reads Never for an exporter that has not exported', () => {
		const { container } = render(TelemetryPage, props({ superAdmin: true, families: [], exporters: [{ name: 'statsd', healthy: true, last_export: '0001-01-01T00:00:00Z', exports: 0, failures: 0 }] }));
		expect(container.textContent).toContain('Never');
		expect(container.textContent).not.toContain('Invalid Date');
	});
});
