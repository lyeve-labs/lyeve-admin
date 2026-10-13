// @vitest-environment jsdom
import { render, cleanup, fireEvent, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy: () => {} }) }));

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
			ok: true,
			value: {
				licensed: true,
				tenant_global: null,
				install_global: { id: 'g', endpoint: '*', rate: 50, burst: 100, enabled: true, kind: 'global', key_by: 'ip', enforced: true },
			},
		},
		addresses: {
			ok: true,
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
			ok: true,
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
					ok: true,
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

	it('explains the self-lockout refusal and the way out inside the address drawer', async () => {
		const { rerender } = render(TenantPage, { props: props() });
		await fireEvent.click(screen.getAllByRole('button', { name: 'New address' })[1]);
		await rerender(props({}, { action: 'address', error: 'That entry would lock you out.', lockout: '0.0.0.0/0' }));
		const drawer = document.body.querySelector('form#address-form')?.textContent ?? '';
		expect(drawer.replace(/\s+/g, ' ')).toContain('Add your own address to the allow list first');
		expect(drawer).toContain('0.0.0.0/0 covers the address you are signed in from');
	});

	it('shows a locked history beside lists that still read', () => {
		const { container } = render(TenantPage, {
			props: props({ history: { ok: false, gate: { state: 'locked', upgradeUrl: '' } } }),
		});
		expect(said(container)).toContain('Not enabled on this instance');
		expect(said(container)).toContain('203.0.113.0/24');
	});

	it('says what an unlicensed install keeps', () => {
		const { container } = render(TenantPage, {
			props: props({ addresses: { ok: true, value: { licensed: false, limits: { entries: { limit: 500, current: 0 } }, rules: [] } } }),
		});
		expect(said(container)).toContain('Adding an address needs a license');
		expect(said(container)).toContain('No address is refused');
	});
});

describe('tenant rate limit drawers', () => {
	const drawerText = (id: string) => document.body.querySelector(`form#${id}`)?.textContent ?? '';

	it('shows a refused limit save inside the limit drawer', async () => {
		const { rerender } = render(TenantPage, { props: props() });
		await fireEvent.click(screen.getByRole('button', { name: 'Set a limit' }));
		await rerender(props({}, { action: 'limit', error: 'The tenant limit could not be saved.' }));
		expect(drawerText('tenant-limit-form')).toContain('The tenant limit could not be saved.');
		expect(drawerText('address-form')).not.toContain('could not be saved');
	});

	it('leaves a newly opened address drawer clean after a failed delete', async () => {
		const { container } = render(TenantPage, {
			props: props({}, { action: 'deleteAddress', error: 'The entry could not be removed.' }),
		});
		expect(said(container)).toContain('The entry could not be removed.');
		await fireEvent.click(screen.getAllByRole('button', { name: 'New address' })[0]);
		expect(drawerText('address-form')).not.toContain('could not be removed');
	});

	it('keeps a refused address out of the limit drawer', async () => {
		const { rerender } = render(TenantPage, { props: props() });
		await fireEvent.click(screen.getAllByRole('button', { name: 'New address' })[0]);
		await rerender(props({}, { action: 'address', error: '198.51.100.7/32 is already on the allow list.' }));
		expect(drawerText('address-form')).toContain('already on the allow list');
		await fireEvent.click(screen.getByRole('button', { name: 'Set a limit' }));
		expect(drawerText('tenant-limit-form')).not.toContain('already on the allow list');
	});
});

describe('the history window', () => {
	it('marks the window the address named on the first render, as links', () => {
		render(TenantPage, { props: props({ hours: 168 }) });
		const group = screen.getByRole('group', { name: 'Window' });
		const current = group.querySelector('[aria-current="page"]');
		expect(current?.textContent).toContain('Last week');
		expect(current?.getAttribute('href')).toBe('?hours=168');
		expect(group.querySelectorAll('a[href^="?hours="]')).toHaveLength(3);
	});
});

describe('the license', () => {
	const unlicensed = {
		limit: {
			ok: true,
			value: {
				licensed: false,
				tenant_global: { id: 't', endpoint: '*', rate: 5, burst: 10, enabled: true, kind: 'tenant_global', key_by: 'ip', enforced: true },
				install_global: null,
			},
		},
		addresses: {
			ok: true,
			value: {
				licensed: false,
				limits: { entries: { limit: 500, current: 1 } },
				rules: [{ id: 'a1', cidr: '198.51.100.7/32', list: 'allow', note: '', created_at: '2026-10-01T00:00:00Z' }],
			},
		},
	};

	it('holds back a new limit and a new address the plugin would refuse, and keeps clearing and removing live', () => {
		render(TenantPage, { props: props(unlicensed) });
		expect((screen.getByRole('button', { name: 'Edit' }) as HTMLButtonElement).disabled).toBe(true);
		for (const b of screen.getAllByRole('button', { name: 'New address' })) expect((b as HTMLButtonElement).disabled).toBe(true);
		expect((screen.getByRole('button', { name: 'Clear' }) as HTMLButtonElement).disabled).toBe(false);
		expect((screen.getByRole('button', { name: 'Delete 198.51.100.7/32' }) as HTMLButtonElement).disabled).toBe(false);
		expect(screen.getByText(/Setting or changing this limit needs a license/)).toBeTruthy();
	});

	it('offers both writes on a licensed install', () => {
		render(TenantPage, { props: props() });
		expect((screen.getByRole('button', { name: 'Set a limit' }) as HTMLButtonElement).disabled).toBe(false);
		for (const b of screen.getAllByRole('button', { name: 'New address' })) expect((b as HTMLButtonElement).disabled).toBe(false);
	});
});
