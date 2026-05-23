// @vitest-environment jsdom
import { render, cleanup, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import DashboardPage from './+page.svelte';

afterEach(cleanup);

function data(overrides: Record<string, unknown> = {}) {
	return {
		schemas: [{ name: 'post', display_name: 'Post', fields: [] }],
		isAdmin: true,
		offers: { schema: true, content: true, analytics: true, jobs: true, logs: true, webhooks: true, audit: true },
		entries: [],
		entryTotal: 0,
		requests: null,
		jobs: null,
		errorsLogged: null,
		webhooks: null,
		window: '24h',
		entriesByStatus: null,
		attention: [],
		traffic: null,
		endpoints: null,
		deadLetters: [],
		audit: [],
		errors: [],
		license: null,
		...overrides,
	} as never;
}

const empty = data({ schemas: [], entryTotal: null });

/*
 * The migration control sits in the shell header on every screen and posts to
 * this page's action. A reader whose JavaScript never ran arrives here with the
 * outcome, so a refusal has to be readable here and nowhere else.
 */
describe('admin dashboard', () => {
	it('announces a migration the engine refused', () => {
		render(DashboardPage, { props: { data: empty, form: { error: 'migration 059 failed' } } });

		expect(screen.getByText('migration 059 failed')).toBeTruthy();
	});

	it('says nothing when nothing failed', () => {
		render(DashboardPage, { props: { data: empty, form: null } });

		expect(screen.queryByText('migration 059 failed')).toBeNull();
		expect(screen.getByText('Dashboard')).toBeTruthy();
	});
});

/*
 * A tile that could not be read says so. Printing zero for an endpoint that
 * answered 404 would tell an operator the instance is quiet when what is
 * true is that nothing was measured.
 */
describe('dashboard tiles', () => {
	it('says unknown, not zero, for a read that failed', () => {
		const { container } = render(DashboardPage, { props: { data: data(), form: null } });

		const text = container.textContent ?? '';
		expect(text).toContain('analytics unavailable');
		expect(text).toContain('jobs unavailable');
		expect(text).toContain('webhooks unavailable');
		expect((text.match(/unknown/g) ?? []).length).toBeGreaterThanOrEqual(4);
	});

	it('states the numbers when the reads succeed', () => {
		const { container } = render(DashboardPage, {
			props: {
				data: data({
					entryTotal: 1234,
					requests: { total: 5000, errorRate: 0.062, p95: 181.4 },
					jobs: { enabled: 7, failed: [{ id: 'a', name: 'a' }, { id: 'b', name: 'b' }] },
					errorsLogged: 9,
					webhooks: { total: 3, unhealthy: 1, pendingDlq: 4 },
					license: { plan: 'example', state: 'grace' },
				}),
				form: null,
			},
		});

		const text = container.textContent ?? '';
		expect(text).toContain('1,234');
		expect(text).toContain('5,000');
		expect(text).toContain('6.2% failed');
		expect(text).toContain('of 7 enabled');
		expect(text).toContain('of 3, 4 dead-lettered');
		expect(text).toContain('Grace period');
		expect(text).not.toContain('unknown');
	});

	it('draws no tile and no list for a plugin that does not run', () => {
		const none = { schema: false, content: false, analytics: false, jobs: false, logs: false, webhooks: false, audit: false };
		const { container } = render(DashboardPage, { props: { data: data({ schemas: [], offers: none }), form: null } });

		const text = container.textContent ?? '';
		for (const gone of ['Collections', 'Entries', 'Requests, 24h', 'Failed jobs', 'Errors logged', 'Webhooks failing', 'What changed', 'No schemas yet']) {
			expect(text, gone).not.toContain(gone);
		}
	});

	it('shows the license tile only when the load sends a license', () => {
		const licensed = render(DashboardPage, {
			props: { data: data({ license: { plan: 'Example', state: 'active' } }), form: null },
		});
		const tile = licensed.container.querySelector('a[href="/admin/settings/license"]');
		expect(tile?.textContent?.replace(/\s+/g, ' ')).toContain('Example');
		expect(tile?.textContent).toContain('Active');
		cleanup();

		const { container } = render(DashboardPage, { props: { data: data(), form: null } });
		expect(container.querySelector('a[href="/admin/settings/license"]')).toBeNull();
		expect(container.textContent).not.toContain('License');
	});

	it('shows an editor only what the engine would let them read', () => {
		const { container } = render(DashboardPage, {
			props: { data: data({ isAdmin: false, entryTotal: 3 }), form: null },
		});

		const text = container.textContent ?? '';
		expect(text).toContain('Entries');
		expect(text).not.toContain('Requests, 24h');
		expect(text).not.toContain('Recent audit entries');
		expect(text).toContain('Recent entries');
	});

	it('links each recent entry to its editor', () => {
		const { container } = render(DashboardPage, {
			props: {
				data: data({
					entries: [{ id: 'e1', schema: 'post', title: 'Hello', slug: 'hello', status: 'published', updated_at: '2026-09-13T00:00:00Z' }],
				}),
				form: null,
			},
		});

		const link = container.querySelector('a[href="/admin/content/post/e1"]');
		expect(link?.textContent).toContain('Hello');
	});
});

/*
 * The window is chosen by link, so it survives a reload and needs no script.
 * The tiles and the chart say which window they were measured over, because
 * a number with no period is not a rate.
 */
describe('dashboard window', () => {
	it('offers the three windows and marks the current one', () => {
		const { container } = render(DashboardPage, {
			props: { data: data({ window: '7d' }), form: null },
		});

		const links = [...container.querySelectorAll('a[href^="/admin?window="]')];
		expect(links.map((a) => a.getAttribute('href'))).toEqual([
			'/admin?window=6h',
			'/admin?window=24h',
			'/admin?window=7d',
		]);
		expect(links.map((a) => a.getAttribute('aria-current'))).toEqual([null, null, 'page']);
		expect(container.textContent).toContain('Requests, 7d');
	});

	it('does not offer a window to an editor, whose tiles are not windowed', () => {
		const { container } = render(DashboardPage, {
			props: { data: data({ isAdmin: false }), form: null },
		});

		expect(container.querySelector('a[href^="/admin?window="]')).toBeNull();
	});
});

/*
 * The tiles say how many. The list says which, and links to the screen that
 * fixes each one, so an operator does not read a red number and then go
 * looking for its cause.
 */
describe('needs attention', () => {
	it('says so when nothing does', () => {
		const { container } = render(DashboardPage, { props: { data: data(), form: null } });

		expect(container.textContent).toContain('Nothing needs attention in the last 24 hours.');
	});

	it('lists each item with its link', () => {
		const { container } = render(DashboardPage, {
			props: {
				data: data({
					attention: [
						{ tone: 'danger', text: 'Job nightly failed on its last run.', href: '/admin/jobs?edit=j1', action: 'Open job' },
						{ tone: 'warn', text: '2 webhooks are unhealthy.', href: '/admin/webhooks', action: 'Webhooks' },
					],
				}),
				form: null,
			},
		});

		const text = container.textContent ?? '';
		expect(text).toContain('Job nightly failed on its last run.');
		expect(container.querySelector('a[href="/admin/jobs?edit=j1"]')?.textContent).toContain('Open job');
		expect(container.querySelector('a[href="/admin/webhooks"]')).not.toBeNull();
		expect(text).not.toContain('Nothing needs attention');
	});

	it('is not shown to an editor', () => {
		const { container } = render(DashboardPage, {
			props: { data: data({ isAdmin: false }), form: null },
		});

		expect(container.textContent).not.toContain('Needs attention');
	});
});

describe('traffic', () => {
	it('draws the trend and the busiest endpoints when both were read', () => {
		const { container } = render(DashboardPage, {
			props: {
				data: data({
					traffic: [
						{ hour: '2026-09-13T10:00:00Z', requests: 10, errorRate: 0 },
						{ hour: '2026-09-13T11:00:00Z', requests: 0, errorRate: 0 },
					],
					endpoints: [{ key: '/api/v1/content', requests: 9, errorRate: 0.1, p95: 20 }],
				}),
				form: null,
			},
		});

		const text = container.textContent ?? '';
		expect(text).toContain('Requests per hour');
		expect(container.querySelectorAll('[data-requests]').length).toBe(2);
		expect(text).toContain('/api/v1/content');
		expect(text).toContain('10.0%');
	});

	it('says which read failed rather than hiding the section', () => {
		const { container } = render(DashboardPage, {
			props: {
				data: data({ traffic: null, endpoints: [] }),
				form: null,
			},
		});

		const text = container.textContent ?? '';
		expect(text).toContain('The trend could not be read.');
		expect(text).toContain('No request in the window.');
	});

	it('is absent when nothing about traffic could be read', () => {
		const { container } = render(DashboardPage, { props: { data: data(), form: null } });

		expect(container.textContent).not.toContain('Requests per hour');
	});
});
