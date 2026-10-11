// @vitest-environment jsdom
import { render, cleanup } from '@testing-library/svelte';
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
