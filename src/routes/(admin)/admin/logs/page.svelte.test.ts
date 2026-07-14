// @vitest-environment jsdom
import { render, cleanup } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';

import LogsPage from './+page.svelte';

afterEach(cleanup);

const NO_TRACE = '00000000000000000000000000000000';
const REAL_TRACE = '4bf92f3577b34da6a3ce929d0e0e4736';

function entry(overrides: Record<string, unknown> = {}) {
	return {
		timestamp: '2026-01-01T00:00:00Z',
		level: 'INFO',
		message: 'a message',
		...overrides,
	};
}

function data(entries: Record<string, unknown>[], overrides: Record<string, unknown> = {}) {
	return {
		entries,
		total: entries.length,
		limit: 100,
		offset: 0,
		levels: null,
		config: null,
		volume: null,
		q: '',
		level: '',
		...overrides,
	};
}

const props = (entries: Record<string, unknown>[], overrides: Record<string, unknown> = {}) => ({
	data: data(entries, overrides) as never,
});

const volume = {
	total: 12,
	by_level: { INFO: 9, ERROR: 3 },
	by_tenant: {},
	by_plugin: {},
	window: '24h',
	since: '',
	alerts: [],
};

function chip(container: HTMLElement, level: string): HTMLAnchorElement {
	const a = [...container.querySelectorAll('a')].find((el) =>
		el.textContent?.trim().startsWith(level)
	);
	if (!a) throw new Error(`no ${level} chip`);
	return a;
}

/*
 * OpenTelemetry spells "no trace" as an all-zero id rather than as an absent
 * field, so a guard on the field alone would print
 * trace=00000000000000000000000000000000 on every row.
 */
describe('Log row trace id', () => {
	it('prints no trace for the all-zero id', () => {
		const { container } = render(LogsPage, { props: props([entry({ trace_id: NO_TRACE })]) });

		expect(container.textContent).not.toContain('trace=');
	});

	it('prints no trace when the field is absent', () => {
		const { container } = render(LogsPage, { props: props([entry()]) });

		expect(container.textContent).not.toContain('trace=');
	});

	it('prints a real trace', () => {
		const { container } = render(LogsPage, { props: props([entry({ trace_id: REAL_TRACE })]) });

		expect(container.textContent).toContain(`trace=${REAL_TRACE}`);
	});

	it('keeps the message when the trace is dropped', () => {
		const { container } = render(LogsPage, {
			props: props([entry({ trace_id: NO_TRACE, message: 'schema migrated' })]),
		});

		expect(container.textContent).toContain('schema migrated');
	});
});

/*
 * The counts per level in the volume card read like filters, so each is a
 * link. A chip keeps the search term and page size and starts from the first
 * page. The active chip clears the level.
 */
describe('Level chips', () => {
	it('filters to the level and resets the position', () => {
		const { container } = render(LogsPage, {
			props: props([entry()], { volume, q: 'boot', limit: 50, offset: 150 }),
		});

		const href = new URL(chip(container, 'ERROR').getAttribute('href') ?? '', 'http://x');
		expect(href.pathname).toBe('/admin/logs');
		expect(href.searchParams.get('level')).toBe('ERROR');
		expect(href.searchParams.get('q')).toBe('boot');
		expect(href.searchParams.get('limit')).toBe('50');
		expect(href.searchParams.get('offset')).toBe('0');
	});

	it('clears the level from the active chip', () => {
		const { container } = render(LogsPage, {
			props: props([entry()], { volume, level: 'ERROR', q: 'boot' }),
		});

		const active = chip(container, 'ERROR');
		expect(active.getAttribute('aria-current')).toBe('true');
		const href = new URL(active.getAttribute('href') ?? '', 'http://x');
		expect(href.searchParams.get('level')).toBeNull();
		expect(href.searchParams.get('q')).toBe('boot');
		expect(chip(container, 'INFO').getAttribute('aria-current')).toBeNull();
	});
});

/*
 * The pager's links carry the filter, or the second page of a filtered list
 * would be the second page of everything.
 */
describe('Paging', () => {
	it('links the next page with the filter kept', () => {
		const { container } = render(LogsPage, {
			props: props([entry()], { total: 250, limit: 100, offset: 0, level: 'WARN', q: 'db' }),
		});

		const links = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href') ?? '');
		const next = links.find((h) => h.includes('offset=100'));
		expect(next).toBeDefined();
		const href = new URL(next ?? '', 'http://x');
		expect(href.searchParams.get('level')).toBe('WARN');
		expect(href.searchParams.get('q')).toBe('db');
		expect(href.searchParams.get('limit')).toBe('100');
	});

	it('states the range and the total', () => {
		const { container } = render(LogsPage, {
			props: props([entry()], { total: 250, limit: 100, offset: 100 }),
		});

		expect(container.textContent).toContain('entries 101 to 200 of 250');
	});
});
