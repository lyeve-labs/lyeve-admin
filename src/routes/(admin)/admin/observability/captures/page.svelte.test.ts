// @vitest-environment jsdom
import { render, cleanup, screen, fireEvent } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy: () => {} }) }));

import CapturesPage from './+page.svelte';

afterEach(cleanup);

function said(c: HTMLElement): string {
	return (c.textContent ?? '').replace(/\s+/g, ' ');
}

const capture = {
	id: 'c1',
	captured_at: '2026-10-06T10:00:00Z',
	method: 'POST',
	url: 'http://localhost:3002/api/v1/content/orders',
	status_code: 201,
	duration_ms: 12.5,
	ttl_seconds: 86400,
};

const rule = {
	id: 'r1',
	route_pattern: '/api/v1/orders/**',
	method: 'POST',
	sample_rate: 0.25,
	retention_seconds: 30 * 86400,
	enabled: true,
	created_at: '2026-10-01T00:00:00Z',
	updated_at: '2026-10-01T00:00:00Z',
};

const set = { id: 's1', name: 'Checkout', capture_ids: ['c1'], created_at: '2026-10-06T11:00:00Z' };

const props = (over: Record<string, unknown> = {}, form: unknown = null) => ({
	data: {
		captures: [capture],
		total: 1,
		limit: 50,
		offset: 0,
		hasMore: false,
		rules: [rule],
		rulesRead: true,
		sets: [set],
		setsRead: true,
		superAdmin: false,
		licensed: true,
		gate: { state: 'ok' },
		...over,
	} as never,
	form: form as never,
});

describe('capture rules', () => {
	it('lists each rule with its method, sample and retention in words', () => {
		const { container } = render(CapturesPage, { props: props() });
		expect(said(container)).toContain('/api/v1/orders/**');
		expect(said(container)).toContain('25%');
		expect(said(container)).toContain('30 days');
		expect(said(container)).toContain('keeps only the requests an enabled rule matches');
	});

	it('says every request is kept for a day when no rule exists', () => {
		const { container } = render(CapturesPage, { props: props({ rules: [] }) });
		expect(said(container)).toContain('No capture rule');
		expect(said(container)).toContain('every request is kept for a day');
	});

	it('says what is not included when the plugin answers unlicensed', () => {
		const { container } = render(CapturesPage, { props: props({ licensed: false }) });
		expect(said(container)).toContain('Capture rules and replay sets are not included');
	});

	// The note said the license was missing while New rule stayed live, so a
	// reader filled in a rule only to be refused on save.
	it('offers no new rule or replay set the license refuses', () => {
		const { getAllByRole } = render(CapturesPage, { props: props({ licensed: false, rules: [] }) });
		const newRule = getAllByRole('button', { name: /New rule/ });
		expect(newRule.length).toBeGreaterThan(0);
		for (const b of newRule) {
			expect((b as HTMLButtonElement).disabled).toBe(true);
			expect(b.getAttribute('title')).toBe('Not included in this license');
		}
		expect((getAllByRole('button', { name: /New replay set/ })[0] as HTMLButtonElement).disabled).toBe(true);
	});

	it('keeps New rule live on a licensed install', () => {
		const { getAllByRole } = render(CapturesPage, { props: props({ licensed: true }) });
		expect((getAllByRole('button', { name: /New rule/ })[0] as HTMLButtonElement).disabled).toBe(false);
	});

	it('reports a failed rules read as a failure', () => {
		const { container } = render(CapturesPage, { props: props({ rules: [], rulesRead: false }) });
		expect(said(container)).toContain('could not be read');
		expect(said(container)).not.toContain('No capture rule');
	});

	it('renders a refused create through the refusal notice', () => {
		render(CapturesPage, {
			props: props({}, { error: 'x', refused: { kind: 'feature', feature: 'example-feature', plugin: 'example', upgradeUrl: '' } }),
		});
		expect(screen.getAllByTestId('refusal-notice').length).toBeGreaterThan(0);
	});
});

describe('replay sets', () => {
	it('offers a new set only once a capture is selected', async () => {
		render(CapturesPage, { props: props() });
		const make = screen.getByRole('button', { name: /New replay set/ }) as HTMLButtonElement;
		expect(make.disabled).toBe(true);
		await fireEvent.click(screen.getByLabelText(/Select POST/));
		expect((screen.getByRole('button', { name: /New replay set from 1/ }) as HTMLButtonElement).disabled).toBe(false);
	});

	it('shows each capture diff of a batch replay', () => {
		const replay = {
			set_id: 's1',
			results: [
				{
					capture_id: 'c1',
					replay_id: 'x1',
					diff: {
						id1: 'c1',
						id2: 'x1',
						status_match: false,
						status_code1: 201,
						status_code2: 409,
						body_diff: '- {"id":1}\n+ {"error":"conflict"}',
						duration1_ms: 12,
						duration2_ms: 9,
					},
				},
				{ capture_id: 'gone', error: 'capture not found, it may have expired' },
			],
		};
		const { container } = render(CapturesPage, { props: props({}, { replay }) });
		const results = screen.getByTestId('replay-results');
		expect(results.textContent).toContain('Replayed Checkout');
		expect(results.textContent).toContain('Status 201 then 409');
		expect(results.textContent).toContain('Changed');
		expect(results.textContent).toContain('{"error":"conflict"}');
		expect(results.textContent).toContain('it may have expired');
		expect(said(container)).toContain('0 of 2 answered as they did');
	});

	it('names each result by the method and path the replay answered', () => {
		const replay = {
			set_id: 's1',
			results: [
				{
					capture_id: 'off-page',
					method: 'PATCH',
					path: '/api/v1/content/orders/7',
					replay_id: 'x2',
					diff: { id1: 'off-page', id2: 'x2', status_match: true, status_code1: 200, status_code2: 200, duration1_ms: 4, duration2_ms: 5 },
				},
				{ capture_id: 'expired-one', error: 'capture not found, it may have expired' },
			],
		};
		render(CapturesPage, { props: props({}, { replay }) });
		const results = screen.getByTestId('replay-results');
		expect(results.textContent).toContain('PATCH /api/v1/content/orders/7');
		expect(results.textContent).not.toContain('off-page');
		expect(results.textContent).toContain('expired-one');
	});

	it('asks to replay again with the writes when the set holds one', () => {
		const { container } = render(CapturesPage, {
			props: props({}, { error: 'writes', needsWrites: 's1' }),
		});
		expect(said(container)).toContain('This set holds a write');
		expect(screen.getByRole('button', { name: 'Replay including writes' })).toBeTruthy();
	});
});

describe('the gate', () => {
	it('says the plugin is absent rather than showing an empty list', () => {
		const { container } = render(CapturesPage, { props: props({ gate: { state: 'absent' }, captures: [] }) });
		expect(said(container)).toContain('not part of this build');
		expect(said(container)).not.toContain('No request is kept');
	});
});

describe('a failed rule save', () => {
	// The message went to the page behind the drawer, so the open panel said
	// nothing about why the save did not happen.
	it('is said at the top of the open form', async () => {
		render(CapturesPage, { props: props({}, { error: 'A route is an absolute path.', drawer: 'rule' }) });
		await fireEvent.click(screen.getAllByRole('button', { name: /New rule/ })[0]);
		const form = document.querySelector('#capture-rule-form') as HTMLFormElement;
		expect(form.textContent).toContain('A route is an absolute path.');
	});

	// The rule and set drawers each showed the other's failures, and every
	// row action's failure too.
	it('keeps a failed set save out of the rule drawer', async () => {
		render(CapturesPage, { props: props({}, { error: 'Name the set so a replay can say which one ran.', drawer: 'set' }) });
		await fireEvent.click(screen.getAllByRole('button', { name: /New rule/ })[0]);
		const form = document.querySelector('#capture-rule-form') as HTMLFormElement;
		expect(form.textContent).not.toContain('Name the set');
	});

	it('says a failed row action on the page and not in the drawer', async () => {
		const { container } = render(CapturesPage, { props: props({}, { error: 'The replay set could not be deleted.' }) });
		expect(said(container)).toContain('The replay set could not be deleted.');
		await fireEvent.click(screen.getAllByRole('button', { name: /New rule/ })[0]);
		const form = document.querySelector('#capture-rule-form') as HTMLFormElement;
		expect(form.textContent).not.toContain('could not be deleted');
	});
});

describe('editing a rule without the license', () => {
	// The plugin refuses any change that leaves a rule enabled, so the drawer
	// could only fail. Switching the rule off stays allowed.
	it('offers no edit of an enabled rule, and offers to switch it off', () => {
		const { container } = render(CapturesPage, { props: props({ licensed: false }) });
		const edit = screen.getByRole('button', { name: `Edit ${rule.route_pattern}` }) as HTMLButtonElement;
		expect(edit.disabled).toBe(true);
		expect(edit.getAttribute('title')).toContain('Not included in this license');
		const off = screen.getByRole('button', { name: `Switch off ${rule.route_pattern}` });
		const form = off.closest('form') as HTMLFormElement;
		expect(form.getAttribute('action')).toBe('?/updateRule');
		expect((form.querySelector('input[name="enabled"]') as HTMLInputElement).value).toBe('false');
		expect((form.querySelector('input[name="from"]') as HTMLInputElement).value).toBe('row');
		void container;
	});

	it('keeps Edit live on a licensed install', () => {
		render(CapturesPage, { props: props({ licensed: true }) });
		expect((screen.getByRole('button', { name: `Edit ${rule.route_pattern}` }) as HTMLButtonElement).disabled).toBe(false);
		expect(screen.queryByRole('button', { name: `Switch off ${rule.route_pattern}` })).toBeNull();
	});
});

describe("a super admin's list", () => {
	// The plugin applies no tenant filter to a super admin's read, so the list
	// and its total cover every tenant.
	it('says it covers every tenant and names each row\'s tenant', () => {
		const { container } = render(CapturesPage, {
			props: props({ superAdmin: true, captures: [{ ...capture, tenant_id: 'acme' }] }),
		});
		expect(said(container)).toContain('Requests every tenant sent');
		expect(said(container)).toContain('Captures from every tenant');
		expect(said(container)).toContain('A replay set holds only captures your own tenant sent');
		expect(screen.getByRole('columnheader', { name: 'Tenant' })).toBeTruthy();
		expect(screen.getByRole('cell', { name: 'acme' })).toBeTruthy();
	});

	it("keeps a tenant admin's list to the tenant", () => {
		const { container } = render(CapturesPage, { props: props() });
		expect(said(container)).toContain('Requests this tenant sent');
		expect(screen.queryByRole('columnheader', { name: 'Tenant' })).toBeNull();
	});
});

describe('a failed side read', () => {
	it('says a refused sets read with its gate', () => {
		const { container } = render(CapturesPage, {
			props: props({ sets: [], setsRead: false, setsGate: { state: 'forbidden' } }),
		});
		expect(said(container)).toContain('Your role cannot open the replay sets');
	});
});

describe('the new replay set button', () => {
	it('carries the Plus every New button carries', async () => {
		render(CapturesPage, { props: props() });
		const button = screen.getByRole('button', { name: /New replay set/ });
		expect(button.querySelector('svg.lucide-plus')).toBeTruthy();
	});
});
