// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Entitlements } from '$lib/entitlements';
import JobsPage from './+page.svelte';

const state = vi.hoisted(() => ({ page: { url: new URL('http://localhost/admin/jobs') } }));
vi.mock('$app/state', () => state);
vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));
const nav = vi.hoisted(() => ({ goto: vi.fn(async () => {}) }));
vi.mock('$app/navigation', () => nav);

afterEach(cleanup);
beforeEach(() => {
	state.page.url = new URL('http://localhost/admin/jobs');
	nav.goto.mockClear();
});

const entitlements: Entitlements = { plan: 'example', state: 'active', features: ['cron'], tenant_quota: 1 };

const job = {
	id: 'j1',
	name: 'Nightly purge',
	description: 'Drops expired rows',
	schedule: '0 2 * * *',
	endpoint: 'https://example.test/purge',
	payload: { keep: 30 },
	enabled: false,
	last_run_at: null,
	last_status: null,
	created_at: '2026-01-01T00:00:00Z',
	updated_at: '2026-01-01T00:00:00Z',
};

function setup(extra: Record<string, unknown> = {}) {
	return render(JobsPage, {
		props: {
			data: { jobs: [job], limit: 50, offset: 0, hasMore: false, openNew: false, openJob: null, entitlements, ...extra },
			form: null,
		} as never,
	});
}

/*
 * A job is written in a drawer over its list, like every other row in the
 * admin, and the query can open the drawer.
 */
describe('the job drawer', () => {
	it('stays shut until asked for', () => {
		const { container } = setup();
		expect(container.querySelector('[role="dialog"]')).toBeNull();
	});

	it('opens empty from the header action and offers Create', async () => {
		const { container, getAllByRole } = setup();
		await fireEvent.click(getAllByRole('button', { name: /new job/i })[0]);
		const dialog = container.querySelector('[role="dialog"]') as HTMLElement;
		expect(dialog.textContent).toContain('New job');
		expect((dialog.querySelector('#job-name') as HTMLInputElement).value).toBe('');
		expect(dialog.querySelector('button[type="submit"]')?.textContent?.trim()).toBe('Create');
	});

	it('opens on the row from its edit control, filled in, and offers Save', async () => {
		const { container, getByRole } = setup();
		await fireEvent.click(getByRole('button', { name: 'Edit Nightly purge' }));
		const dialog = container.querySelector('[role="dialog"]') as HTMLElement;
		expect(dialog.textContent).toContain('Edit Nightly purge');
		expect((dialog.querySelector('#job-schedule') as HTMLInputElement).value).toBe('0 2 * * *');
		expect((dialog.querySelector('#job-payload') as HTMLTextAreaElement).value).toContain('"keep": 30');
		expect((dialog.querySelector('input[name="enabled"]') as HTMLInputElement).value).toBe('off');
		expect((dialog.querySelector('input[name="id"]') as HTMLInputElement).value).toBe('j1');
		expect(dialog.querySelector('button[type="submit"]')?.textContent?.trim()).toBe('Save');
	});

	it('opens on the job the address names', () => {
		state.page.url = new URL('http://localhost/admin/jobs?edit=j1');
		const { container } = setup({ openJob: job });
		const dialog = container.querySelector('[role="dialog"]') as HTMLElement;
		expect(dialog.textContent).toContain('Edit Nightly purge');
	});

	it('opens empty when the address asks for a new job', () => {
		state.page.url = new URL('http://localhost/admin/jobs?new=1');
		const { container } = setup({ openNew: true });
		expect(container.querySelector('[role="dialog"]')?.textContent).toContain('New job');
	});

	it('takes the query out of the address when the drawer is put away', async () => {
		state.page.url = new URL('http://localhost/admin/jobs?edit=j1');
		const { getByRole } = setup({ openJob: job });
		await fireEvent.click(getByRole('button', { name: 'Cancel' }));
		expect(nav.goto).toHaveBeenCalledWith('/admin/jobs', expect.objectContaining({ replaceState: true }));
	});
});

describe('the job list toolbar', () => {
	it('narrows the page by the typed fragment', async () => {
		const other = { ...job, id: 'j2', name: 'Weekly digest', schedule: '0 9 * * 1' };
		const { container } = setup({ jobs: [job, other] });
		const box = container.querySelector('#job-search') as HTMLInputElement;
		await fireEvent.input(box, { target: { value: 'digest' } });
		const names = [...container.querySelectorAll('tbody td p.font-medium')].map((p) => p.textContent);
		expect(names).toEqual(['Weekly digest']);
	});
});

describe('the job alert channels', () => {
	it('shows each stored channel masked, PagerDuty included, so a save keeps them', () => {
		const alerting = {
			...job,
			alerts: {
				email: ['ops@example.com'],
				slack_url: 'https://hooks.slack.com/...1a2b',
				pagerduty_routing_key: '...cdef',
				failure_threshold: 3,
			},
		};
		const { container } = setup({ jobs: [alerting], openJob: alerting });
		const dialog = container.querySelector('[role="dialog"]') as HTMLElement;
		expect((dialog.querySelector('#job-alert-slack') as HTMLInputElement).value).toBe('https://hooks.slack.com/...1a2b');
		const pd = dialog.querySelector('#job-alert-pagerduty') as HTMLInputElement;
		expect(pd.value).toBe('...cdef');
		expect(pd.name).toBe('alert_pagerduty_routing_key');
		expect(pd.disabled).toBe(false);
		expect((dialog.querySelector('input[name="alerts_stored"]') as HTMLInputElement).value).toBe('true');
	});
});
