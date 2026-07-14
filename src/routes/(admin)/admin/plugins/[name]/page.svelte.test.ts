// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import type { PluginDetail } from '$lib/plugin-rows';
import type { PluginBreakdown } from '$lib/api/profiler';

import PluginDetailPage from './+page.svelte';

afterEach(cleanup);

const SEARCH: PluginDetail = {
	name: 'search',
	label: 'Search',
	description: 'Ranked full-text search across every schema.',
	category: 'content',
	beta: false,
	state: 'running',
	reason: null,
	upgradeUrl: null,
	version: '1.4.0',
	startedAt: '2026-10-01T08:00:00Z',
	routes: [
		{ method: 'POST', pattern: '/api/admin/search/reindex', group: 'admin' },
		{ method: 'GET', pattern: '/api/v1/search', group: 'public' },
	],
};

const TRAFFIC: PluginBreakdown = {
	plugin: 'search',
	count: 1234,
	avg_duration_ns: 2_000_000,
	max_duration_ns: 9_000_000,
	total_alloc_bytes: 2048,
};

interface Options {
	roles?: string[];
	traffic?: PluginBreakdown | null;
	trafficRead?: boolean;
}

function renderPage(plugin: PluginDetail | null, { roles = ['super_admin'], traffic = null, trafficRead = true }: Options = {}) {
	return render(PluginDetailPage, {
		props: {
			data: { pluginName: plugin?.name ?? 'search', plugin, traffic, trafficRead, userRoles: roles },
		} as never,
	});
}

describe('plugin detail page', () => {
	it('names the plugin by its label and says what it does', () => {
		const { container } = renderPage(SEARCH);
		expect(container.querySelector('h1')?.textContent).toContain('Search');
		expect(screen.getByText('Ranked full-text search across every schema.')).toBeTruthy();
	});

	it('lists its name, category, state, version and start time', () => {
		const { container } = renderPage(SEARCH);
		const list = container.querySelector('dl');
		expect(list?.textContent).toContain('search');
		expect(list?.textContent).toContain('Content');
		expect(list?.textContent).toContain('Running');
		expect(list?.textContent).toContain('1.4.0');
		expect(list?.textContent).toContain('2026-10-01 08:00 UTC');
	});

	it('leaves out a version and a start time the engine did not send', () => {
		const { container } = renderPage({ ...SEARCH, version: null, startedAt: null });
		const list = container.querySelector('dl');
		expect(list?.textContent).not.toContain('Version');
		expect(list?.textContent).not.toContain('Running since');
	});

	it('marks a beta plugin, and only a beta one', () => {
		renderPage({ ...SEARCH, beta: true });
		expect(screen.getByText('Beta')).toBeTruthy();
		cleanup();
		renderPage(SEARCH);
		expect(screen.queryByText('Beta')).toBeNull();
	});

	it('lists the routes it serves, public ones first, with who can call each', () => {
		const { container } = renderPage(SEARCH);
		expect(screen.getByText('2 routes')).toBeTruthy();
		const rows = [...container.querySelectorAll('tbody tr')].map((tr) =>
			[...tr.querySelectorAll('td')].map((td) => td.textContent?.trim()),
		);
		expect(rows).toEqual([
			['GET', '/api/v1/search', 'Anyone'],
			['POST', '/api/admin/search/reindex', 'Admins'],
		]);
	});

	it('says a running plugin with no routes works without any', () => {
		renderPage({ ...SEARCH, routes: [] });
		expect(screen.getByText('No routes of its own')).toBeTruthy();
	});

	it('says a plugin that does not run serves nothing, and why it does not run', () => {
		const { container } = renderPage({
			...SEARCH,
			state: 'not-enabled',
			reason: 'not enabled here',
			upgradeUrl: '/admin/settings/license',
			startedAt: null,
			routes: [],
		});
		expect(screen.getByText('Serves nothing yet')).toBeTruthy();
		const list = container.querySelector('dl');
		expect(list?.textContent).toContain('Not enabled');
		expect(list?.textContent).toContain('not enabled here');
		expect(list?.querySelector('a[href="/admin/settings/license"]')?.textContent).toContain('How to enable it');
	});

	it('shows the error a failed plugin stopped with', () => {
		const { container } = renderPage({ ...SEARCH, state: 'failed', reason: 'migration 12 already applied', routes: [] });
		expect(container.querySelector('dl')?.textContent).toContain('migration 12 already applied');
	});

	it("shows a super admin the requests the profiler sampled through it", () => {
		const { getByTestId } = renderPage(SEARCH, { traffic: TRAFFIC });
		expect(getByTestId('traffic-stats').textContent).toContain('1,234');
	});

	it('tells a profiler that did not answer from a plugin it never sampled', () => {
		renderPage(SEARCH, { trafficRead: false });
		expect(screen.getByText('Request statistics unavailable')).toBeTruthy();
		cleanup();
		renderPage(SEARCH, { trafficRead: true, traffic: null });
		expect(screen.getByText('Nothing sampled yet')).toBeTruthy();
	});

	it('shows no request statistics to an admin', () => {
		renderPage(SEARCH, { roles: ['admin'], trafficRead: false });
		expect(screen.queryByText('Requests')).toBeNull();
		expect(screen.queryByText('Request statistics unavailable')).toBeNull();
	});

	it('reads only, with no form on the page', () => {
		const { container } = renderPage(SEARCH, { traffic: TRAFFIC });
		expect(container.querySelector('form')).toBeNull();
	});

	it('names the plugin by its name when nothing describes it', () => {
		const { container } = renderPage(null, { roles: ['admin'], trafficRead: false });
		expect(container.querySelector('h1')?.textContent).toContain('search');
		expect(container.querySelector('dl')).toBeNull();
		expect(
			screen.getByText('What this plugin is and what it serves on this instance.'),
		).toBeTruthy();
	});
});
