// @vitest-environment jsdom
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy: () => {} }) }));

import UsagePage from './+page.svelte';

afterEach(cleanup);

const MIRA = '24d6560b-540e-47b6-8957-59934db4021d';

function said(c: HTMLElement): string {
	return (c.textContent ?? '').replace(/\s+/g, ' ');
}

const request = (requested_by: string) => ({
	id: 'q1',
	tenant_id: 'default',
	requested_by,
	requests_limit: 100000,
	reason: 'Launch traffic in November',
	status: 'pending',
	reviewed_by: '',
	created_at: '2026-10-11T18:36:49Z',
});

const props = (over: Record<string, unknown> = {}) => ({
	data: {
		user: { id: 'u1', email: 'admin@example.com', roles: ['super_admin'] },
		quotas: [],
		quotaTotal: 0,
		limit: 50,
		offset: 0,
		requests: [request(MIRA)],
		requestsRead: true,
		usage: [],
		usageRead: true,
		people: { [MIRA]: 'mira.costa@example.com' },
		gate: { state: 'ok' },
		permitted: true,
		...over,
	} as never,
	form: null as never,
});

describe('Requests for more', () => {
	it('names the requester by email', () => {
		const { container } = render(UsagePage, { props: props() });
		const text = said(container);
		expect(text).toContain('by mira.costa@example.com');
		expect(text).not.toContain(MIRA);
	});

	it('keeps a short id for an account the directory did not answer', () => {
		const { container } = render(UsagePage, { props: props({ people: {} }) });
		const text = said(container);
		expect(text).toContain('by 24d6560b');
		expect(text).not.toContain(MIRA);
	});
});

describe('Quotas when the usage could not be read', () => {
	const quota = {
		id: 'q1',
		tenant_id: 'acme',
		requests_limit: 1000,
		storage_bytes_limit: 0,
		bandwidth_bytes_limit: 0,
		is_hard_limit: true,
		block_on_exceeded: true,
		grace_period_hours: 0,
		warn_at_pct_80: true,
		warn_at_pct_90: true,
		blocked_at: null,
	};

	it('says so over the table rather than drawing rows that used nothing', () => {
		const { container } = render(UsagePage, {
			props: props({ quotas: [quota], quotaTotal: 1, usageRead: false }),
		});
		expect(said(container)).toContain('What each tenant used could not be read');
		cleanup();
		const answered = render(UsagePage, { props: props({ quotas: [quota], quotaTotal: 1, usageRead: true }) });
		expect(said(answered.container)).not.toContain('could not be read');
	});
});

/*
 * Every form on the page shares one action result. A drawer that read it
 * whole showed a failed review in the next New quota form as if that form had
 * failed.
 */
describe('the quota drawer and the failures of other actions', () => {
	const drawerText = () => document.body.querySelector('form#quota-form')?.textContent ?? '';

	it('leaves a newly opened quota drawer clean after a failed review', async () => {
		const { container, getAllByRole } = render(UsagePage, {
			props: { ...props(), form: { action: 'review', error: 'The request could not be reviewed.' } as never },
		});
		expect(said(container)).toContain('The request could not be reviewed.');
		await fireEvent.click(getAllByRole('button', { name: /new quota/i })[0]);
		expect(drawerText()).not.toContain('could not be reviewed');
	});

	it('shows a failed save inside the open drawer', async () => {
		const { getAllByRole, rerender } = render(UsagePage, { props: props() });
		await fireEvent.click(getAllByRole('button', { name: /new quota/i })[0]);
		await rerender({ ...props(), form: { action: 'quota', error: 'The quota could not be saved.' } as never });
		expect(drawerText()).toContain('The quota could not be saved.');
	});
});

describe('the quota list', () => {
	const quota = (tenant_id: string) => ({
		id: `q-${tenant_id}`,
		tenant_id,
		requests_limit: 1000,
		storage_bytes_limit: 0,
		bandwidth_bytes_limit: 0,
		is_hard_limit: true,
		block_on_exceeded: true,
		grace_period_hours: 0,
		warn_at_pct_80: true,
		warn_at_pct_90: true,
		blocked_at: null,
	});

	it('narrows the page by the typed tenant', async () => {
		const { container } = render(UsagePage, { props: props({ quotas: [quota('acme'), quota('globex')], quotaTotal: 2 }) });
		await fireEvent.input(container.querySelector('#quota-search') as HTMLInputElement, { target: { value: 'glob' } });
		const rows = [...container.querySelectorAll('table[aria-label="Quotas"] tbody tr, [aria-label="Quotas"] tbody tr')].map((tr) => tr.textContent ?? '');
		expect(rows.some((t) => t.includes('globex'))).toBe(true);
		expect(rows.some((t) => t.includes('acme'))).toBe(false);
	});

	it('offers the first quota from the empty list', () => {
		const { getAllByRole } = render(UsagePage, { props: props() });
		expect(getAllByRole('button', { name: /new quota/i })).toHaveLength(2);
	});
});
