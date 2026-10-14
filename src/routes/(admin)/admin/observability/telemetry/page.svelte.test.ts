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

// The exporters as the plugin encodes them. Its times are Go time values,
// which JSON writes as the zero time rather than leaving them out.
const EXPORTERS = [
	{
		name: 'pushgateway',
		healthy: true,
		last_export: '2026-09-21T10:00:00Z',
		last_failure: '0001-01-01T00:00:00Z',
		exports: 4,
		failures: 0,
	},
	{
		name: 'otlp',
		healthy: false,
		last_export: '2026-09-21T09:00:00Z',
		last_failure: '2026-09-21T10:00:00Z',
		last_error: 'otlp: export: dial tcp 10.0.0.9:4318: connect: connection refused',
		last_error_class: 'unreachable',
		exports: 1,
		failures: 3,
	},
];

/** A read that answered. */
function ok<T>(value: T) {
	return { ok: true, value };
}

/** A read that failed, as the load hands it over. */
function failed(gate: Record<string, unknown>) {
	return { ok: false, gate };
}

const NO_DESTINATION = ok({ destination: null, licensed: true });

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

/**
 * The page's data. Families and exporters are given as their values and
 * wrapped as answered reads, unless a test passes a whole section.
 */
function props(data: Record<string, unknown>, form: Record<string, unknown> | null = null) {
	const section = (v: unknown) => (v === null || (typeof v === 'object' && 'ok' in (v as object)) ? v : ok(v));
	return {
		data: {
			destination: NO_DESTINATION,
			...data,
			families: section(data.families),
			exporters: section(data.exporters),
		} as never,
		form: form as never,
	};
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
		expect(container.textContent).toContain('connection refused');
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
	it('says the engine did not answer the scrape rather than showing an empty registry', () => {
		const { container, queryByRole } = render(
			TelemetryPage,
			props({ superAdmin: false, families: failed({ state: 'unavailable' }), exporters: null }),
		);
		expect(container.textContent).toContain('so Telemetry metrics could not be read');
		expect(container.textContent).not.toContain('No series yet');
		expect(queryByRole('searchbox', { name: 'Filter families' })).toBeNull();
	});

	it('says the role cannot read the metrics and offers no retry', () => {
		const { container, queryByRole } = render(
			TelemetryPage,
			props({ superAdmin: false, families: failed({ state: 'forbidden' }), exporters: null }),
		);
		expect(container.textContent).toContain('Your role cannot open Telemetry metrics.');
		expect(queryByRole('link', { name: /Try again/ })).toBeNull();
	});

	it('keeps the sentence of a failed scrape', () => {
		const message = 'The metrics could not be read. This is not a report that no series exist.';
		const { container } = render(
			TelemetryPage,
			props({ superAdmin: true, families: failed({ state: 'error', message }), exporters: [] }),
		);
		expect(container.textContent).toContain(message);
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

	it('says the exporter list failed rather than that none is configured', () => {
		const message = 'The exporters could not be read. This is not a report that none is configured.';
		const { container, queryByTestId } = render(
			TelemetryPage,
			props({ superAdmin: true, families: [], exporters: failed({ state: 'error', message }) }),
		);
		expect(queryByTestId('telemetry-exporters')?.textContent).toContain(message);
		expect(container.textContent).not.toContain('No exporter configured');
	});

	it('says no exporter is configured rather than rendering an empty table', () => {
		const { container } = render(TelemetryPage, props({ superAdmin: true, families: [], exporters: [] }));
		expect(container.textContent).toContain('No exporter configured');
	});

	it('reads Never for an exporter that has not exported', () => {
		const { container } = render(TelemetryPage, props({ superAdmin: true, families: [], exporters: [{ name: 'statsd', healthy: true, last_export: '0001-01-01T00:00:00Z', last_failure: '0001-01-01T00:00:00Z', exports: 0, failures: 0 }] }));
		expect(container.textContent).toContain('Never');
		expect(container.textContent).not.toContain('Invalid Date');
	});
});
