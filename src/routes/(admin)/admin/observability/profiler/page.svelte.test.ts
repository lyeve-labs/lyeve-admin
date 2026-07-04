// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/navigation', () => ({ goto: vi.fn(async () => {}), invalidateAll: vi.fn(async () => {}) }));
vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));

import ProfilerPage from './+page.svelte';

const STATS = {
	endpoint: '/api/v1/content',
	method: 'GET',
	count: 4,
	avg_duration_ns: 1_500_000,
	p50_duration_ns: 1_000_000,
	p95_duration_ns: 2_500_000_000,
	p99_duration_ns: 3_000_000_000,
	max_duration_ns: 4_000_000_000,
	avg_alloc_bytes: 2048,
	total_alloc_bytes: 8192,
	last_seen: '2026-09-21T10:00:00Z',
};

const MEMORY = {
	snapshots: [{ timestamp: '2026-09-21T10:00:00Z', heap_alloc: 3 * 1024 * 1024, heap_objects: 10, total_alloc: 4096, num_gc: 2, num_goroutine: 30 }],
	slope_bytes_per_sec: 2048,
	leak_likely: true,
	leak_reason: 'heap grew for 10 snapshots',
};

function page(over: Record<string, unknown> = {}) {
	return {
		endpoints: [STATS],
		slowest: [STATS],
		plugins: [{ plugin: 'core', count: 4, avg_duration_ns: 1_000_000, max_duration_ns: 2_000_000, total_alloc_bytes: 4096 }],
		memory: MEMORY,
		selected: null,
		detail: null,
		...over,
	};
}

function props(data: Record<string, unknown>, form: Record<string, unknown> | null = null) {
	return { data: data as never, form: form as never };
}

afterEach(cleanup);

describe('the profiler page', () => {
	it('renders the memory trend with the leak verdict, the slowest table and the plugin breakdown', () => {
		const { container, getByTestId } = render(ProfilerPage, props(page()));
		expect(container.textContent).toContain('Leak likely');
		expect(container.textContent).toContain('heap grew for 10 snapshots');
		expect(getByTestId('memory-stats').textContent).toContain('3.0 MiB');
		expect(getByTestId('profiler-slowest').textContent).toContain('/api/v1/content');
		expect(getByTestId('profiler-slowest').textContent).toContain('2.50s');
		expect(getByTestId('profiler-plugins').textContent).toContain('core');
	});

	it('links every endpoint row to its own detail by query parameter', () => {
		const { container } = render(ProfilerPage, props(page()));
		const link = container.querySelector('a[href^="/admin/observability/profiler?endpoint="]');
		expect(link?.getAttribute('href')).toBe('/admin/observability/profiler?endpoint=api%2Fv1%2Fcontent');
	});

	it('renders the selected endpoint with its recent entries', () => {
		const detail = {
			endpoint: '/api/v1/content',
			methods: [{ method: 'GET', count: 4, stats: STATS, recent_entries: [{ plugin: 'core', endpoint: '/api/v1/content', method: 'GET', duration_ns: 1_000_000, status_code: 503, alloc_bytes: 100, total_alloc: 1, heap_alloc: 1, heap_objects: 1, num_gc: 1, num_goroutine: 9, captured_at: '2026-09-21T10:00:00Z' }] }],
			total_count: 4,
			limit: 100,
			offset: 0,
		};
		const { getByTestId } = render(ProfilerPage, props(page({ selected: '/api/v1/content', detail })));
		const section = getByTestId('profiler-detail');
		expect(section.textContent).toContain('4 entries in the ring');
		expect(section.textContent).toContain('Recent GET requests');
		expect(section.textContent).toContain('503');
	});

	it('says the ring holds nothing for a selection the engine did not answer', () => {
		const { getByTestId } = render(ProfilerPage, props(page({ selected: '/nothing', detail: null })));
		expect(getByTestId('profiler-detail').textContent).toContain('No data for this endpoint');
	});

	it('says which view the engine did not answer instead of rendering zeros', () => {
		const { container } = render(ProfilerPage, props(page({ memory: null, slowest: null, plugins: null })));
		expect(container.textContent).toContain('Memory trend unavailable');
		expect(container.textContent).toContain('Profiler unavailable');
		expect(container.textContent).toContain('Plugin breakdown unavailable');
	});

	// The exports post to the admin's own proxy, which forwards the session
	// to the engine's debug route and hands the pprof bytes back as a file.
	it('offers the four pprof exports as downloads through the debug proxy', () => {
		const { getByTestId } = render(ProfilerPage, props(page()));
		const forms = [...getByTestId('profiler-exports').querySelectorAll('form')].map((f) => f.getAttribute('action'));
		expect(forms).toEqual([
			'/api/admin/debug/profiler/profile/cpu',
			'/api/admin/debug/profiler/profile/goroutine',
			'/api/admin/debug/profiler/profile/heap',
			'/api/admin/debug/profiler/profile/allocs',
		]);
	});

	it('draws a captured flamegraph as an image from its SVG', () => {
		const graph = { endpoint: '/api/v1/content', duration_sec: 5, svg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>', profile_type: 'cpu', captured_at: '2026-09-21T10:00:00Z' };
		const { getByTestId } = render(ProfilerPage, props(page(), { form: 'flamegraph', graph }));
		const img = getByTestId('flamegraph').querySelector('img');
		expect(img?.getAttribute('src')).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);
		expect(img?.getAttribute('alt')).toContain('/api/v1/content');
	});

	it('relays a refused capture on the flamegraph form', () => {
		const { container } = render(ProfilerPage, props(page(), { form: 'flamegraph', error: 'flamegraph generation failed' }));
		expect(container.textContent).toContain('flamegraph generation failed');
	});
});
