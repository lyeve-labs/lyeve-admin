// @vitest-environment jsdom
import { render, cleanup, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy: () => {} }) }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

import TenantPage from './+page.svelte';

afterEach(cleanup);

function said(c: HTMLElement): string {
	return (c.textContent ?? '').replace(/\s+/g, ' ');
}

const ok = { state: 'ok' };

const props = (over: Record<string, unknown> = {}, form: unknown = null) => ({
	data: {
		gate: ok,
		hours: 24,
		limit: {
			gate: ok,
			value: {
				licensed: true,
				tenant_global: null,
				install_global: { id: 'g', endpoint: '*', rate: 50, burst: 100, enabled: true, kind: 'global', key_by: 'ip', enforced: true },
			},
		},
		addresses: {
			gate: ok,
			value: {
				licensed: true,
				limits: { entries: { limit: 500, current: 2 } },
				rules: [
					{ id: 'a1', cidr: '198.51.100.7/32', list: 'allow', note: 'office', created_at: '2026-10-01T00:00:00Z' },
					{ id: 'd1', cidr: '203.0.113.0/24', list: 'deny', note: '', created_at: '2026-10-01T00:00:00Z' },
				],
			},
		},
		history: {
			gate: ok,
			value: {
				hours: 24,
				total_refused: 7,
				minutes: [
					{ minute: '2026-10-06T10:00:00Z', rule_id: 'd1', kind: 'deny', endpoint: '203.0.113.0/24', refused: 4 },
					{ minute: '2026-10-06T10:01:00Z', rule_id: 'd1', kind: 'deny', endpoint: '203.0.113.0/24', refused: 3 },
				],
			},
		},
		...over,
	} as never,
	form: form as never,
});

describe('tenant rate limits', () => {
	it('says the install limit applies beside the tenant one', () => {
		const { container } = render(TenantPage, { props: props() });
		expect(said(container)).toContain("No limit of this tenant's own");
		expect(said(container)).toContain('50/second');
		expect(said(container)).toContain('can only tighten');
	});

	it('lists each address on its list and counts them against the stated ceiling', () => {
		const { container } = render(TenantPage, { props: props() });
		expect(said(container)).toContain('2 of 500 entries');
		expect(screen.getByRole('region', { name: 'Allow list' }).textContent).toContain('198.51.100.7/32');
		expect(screen.getByRole('region', { name: 'Deny list' }).textContent).toContain('203.0.113.0/24');
	});

	it('counts the entries without a ceiling when the plugin states none', () => {
		const { container } = render(TenantPage, {
			props: props({
				addresses: {
					gate: ok,
					value: {
						licensed: true,
						limits: { entries: { limit: null, current: 1 } },
						rules: [{ id: 'a1', cidr: '198.51.100.7/32', list: 'allow', note: '', created_at: '2026-10-01T00:00:00Z' }],
					},
				},
			}),
		});
		expect(said(container)).toContain('1 entry');
		expect(said(container)).not.toMatch(/\d+ of \d+ entries/);
	});

	it('sums the refusal minutes per entry', () => {
		const { container } = render(TenantPage, { props: props() });
		const table = screen.getByRole('region', { name: 'Refusals by rule' });
		expect(table.textContent).toContain('Deny list');
		expect(table.textContent).toContain('7');
		expect(said(container)).toContain('7 requests refused');
	});

	it('explains the self-lockout refusal and the way out', () => {
		const { container } = render(TenantPage, {
			props: props({}, { error: 'this entry would refuse the address you are calling from', lockout: '0.0.0.0/0' }),
		});
		expect(said(container)).toContain('That entry would lock you out');
		expect(said(container)).toContain('Add your own address to the allow list first');
	});

	it('shows a locked history beside lists that still read', () => {
		const { container } = render(TenantPage, {
			props: props({ history: { gate: { state: 'locked', upgradeUrl: '' }, value: null } }),
		});
		expect(said(container)).toContain('Not enabled on this instance');
		expect(said(container)).toContain('203.0.113.0/24');
	});

	it('says what an unlicensed install keeps', () => {
		const { container } = render(TenantPage, {
			props: props({ addresses: { gate: ok, value: { licensed: false, limits: { entries: { limit: 500, current: 0 } }, rules: [] } } }),
		});
		expect(said(container)).toContain('Adding an address needs a license');
		expect(said(container)).toContain('No address is refused');
	});
});
