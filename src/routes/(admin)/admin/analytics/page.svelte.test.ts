// @vitest-environment jsdom
import { render, cleanup } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';

import AnalyticsPage from './+page.svelte';

afterEach(cleanup);

function said(c: HTMLElement): string {
	return (c.textContent ?? '').replace(/\s+/g, ' ');
}

const summary = {
	from: '',
	to: '',
	total_requests: 1913,
	total_2xx: 1900,
	total_4xx: 13,
	total_5xx: 0,
	error_rate: 0.0068,
	avg_latency_p50_ms: 1,
	avg_latency_p95_ms: 4,
	avg_latency_p99_ms: 9,
	max_latency_p99_ms: 20,
	avg_request_size_bytes: 0,
	max_request_size_bytes: 0,
	unique_endpoints: 2,
	unique_tenants: 1,
	unique_methods: 4,
	unique_user_agents: 1,
};

function method(key: string, request_count: number) {
	return {
		key,
		request_count,
		error_rate: 0,
		avg_latency_p95_ms: 1,
		max_latency_p99_ms: 1,
		request_size_avg_bytes: 0,
	};
}

const props = (over: Record<string, unknown> = {}) => ({
	data: {
		summary,
		endpoints: { items: [], total: 0 },
		methods: { items: [method('GET', 1731), method('POST', 171), method('PUT', 10), method('PATCH', 1)], total: 4 },
		agents: { items: [], total: 0 },
		anomalies: { anomalies: [], window_hours: 0, z_threshold: 0 },
		...over,
	} as never,
});

describe('what the page counts', () => {
	// The plugin records every request to both APIs, the console's own
	// included, so the page cannot claim to cover the public one alone.
	it('says it counts both APIs', () => {
		const { container } = render(AnalyticsPage, { props: props() });
		const text = said(container);
		expect(text).toContain('across the Content API and the Admin API');
		expect(text).not.toContain('public API');
	});
});

describe('HTTP methods', () => {
	function shares(container: HTMLElement): Record<string, string> {
		const out: Record<string, string> = {};
		for (const bar of container.querySelectorAll('[role="progressbar"]')) {
			const label = bar.getAttribute('aria-label') ?? '';
			const row = bar.parentElement;
			const pct = row?.querySelector('.tabular-nums')?.textContent?.trim() ?? '';
			out[label.split(' ')[0] ?? label] = pct;
		}
		return out;
	}

	// A share of every request, so the busiest method does not read 100%.
	it('states each method as a share of all requests', () => {
		const { container } = render(AnalyticsPage, { props: props() });
		const got = shares(container);
		expect(got.GET).toBe('90%');
		expect(got.POST).toBe('9%');
		expect(got.PUT).toBe('1%');
		expect(got.PATCH).toBe('0%');
	});
});
