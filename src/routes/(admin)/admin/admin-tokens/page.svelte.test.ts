// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Page from './+page.svelte';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }), applyAction: vi.fn() }));
vi.mock('$app/navigation', () => ({ goto: vi.fn(), invalidateAll: vi.fn() }));
vi.mock('$app/state', () => ({ page: { url: new URL('http://admin/admin/admin-tokens') } }));

afterEach(cleanup);

const DAY = 24 * 60 * 60 * 1000;
const at = (days: number) => new Date(Date.now() + days * DAY).toISOString();

function token(over: Record<string, unknown>) {
	return {
		id: 't1',
		tenant_id: 'default',
		owner_user_id: 'u1',
		owner_email: 'me@b.test',
		name: 'ci-deploy',
		display_prefix: 'abcd1234',
		grants: ['schemas:read'],
		allowed_ips: [],
		expires_at: at(30),
		created_at: at(-1),
		last_used_at: null,
		revoked_at: null,
		rotated_from: null,
		...over,
	};
}

function setup(over: Record<string, unknown> = {}, roles = ['super_admin']) {
	const data = {
		user: { id: 'u1', email: 'me@b.test', roles, tenant_id: 'default' },
		tokens: [],
		total: 0,
		limit: 50,
		offset: 0,
		listError: '',
		grants: [{ name: 'schemas:read', description: 'Read schemas.', routes: [{ method: 'GET', pattern: '/api/admin/schemas' }] }],
		mfaEnrolled: false,
		tenants: [],
		log: null,
		adminOrigin: 'http://admin',
		...over,
	};
	return render(Page, { props: { data, form: null } as never });
}

describe('admin tokens page', () => {
	it('explains what a token is for when there is none, and offers one', () => {
		const { getByText, getAllByRole } = setup();
		expect(getByText('No admin tokens yet')).toBeTruthy();
		expect(getByText(/call the admin API with only the grants you give it/)).toBeTruthy();
		expect(getAllByRole('button', { name: /New token/ }).length).toBeGreaterThan(0);
	});

	it('says the list could not be read rather than drawing it empty', () => {
		const { getByText, queryByText } = setup({ listError: 'The database is unavailable, so the list could not be read. Try again in a moment.' });
		expect(getByText(/database is unavailable/)).toBeTruthy();
		expect(queryByText('No admin tokens yet')).toBeNull();
	});

	it('reads each row status, and offers only the actions that row allows', () => {
		const { getByText, getByRole, queryByRole, getAllByText } = setup({
			tokens: [
				token({ id: 'new', rotated_from: 'old', expires_at: at(3), owner_user_id: 'u1' }),
				token({ id: 'old', name: 'legacy', expires_at: at(5) }),
				token({ id: 'gone', name: 'gone', revoked_at: at(-1) }),
				token({ id: 'past', name: 'past', expires_at: at(-2) }),
				token({ id: 'theirs', name: 'theirs', owner_user_id: 'u2', owner_email: 'other@b.test' }),
			],
			total: 5,
		});
		expect(getAllByText('Active').length).toBeGreaterThan(0);
		const row = (name: string) => getByText(name).closest('tr')?.textContent ?? '';
		expect(row('legacy')).toContain('Replaced');
		expect(row('gone')).toContain('Revoked');
		expect(row('past')).toContain('Expired');
		expect(getByText('other@b.test')).toBeTruthy();
		expect(getByText(/expired 2 days ago/)).toBeTruthy();
		expect(getByRole('button', { name: 'Rotate ci-deploy' })).toBeTruthy();
		expect(queryByRole('button', { name: 'Rotate legacy' })).toBeNull();
		expect(queryByRole('button', { name: 'Rotate theirs' })).toBeNull();
		expect(getByRole('button', { name: 'Revoke theirs' })).toBeTruthy();
		expect(queryByRole('button', { name: 'Revoke gone' })).toBeNull();
		expect(queryByRole('button', { name: 'Revoke past' })).toBeNull();
		expect(getByRole('link', { name: 'Request log of gone' }).getAttribute('href')).toBe('/admin/admin-tokens?log=gone');
	});

	it('shows no owner column to an admin, who sees only their own tokens', () => {
		const { queryByRole } = setup({ tokens: [token({})], total: 1 }, ['admin']);
		expect(queryByRole('columnheader', { name: 'Owner' })).toBeNull();
	});

	it('reads a dropped row in the request log as the requests it lost', () => {
		const { getByText } = setup({
			tokens: [token({})],
			total: 1,
			log: {
				token: 't1',
				rows: [
					{ id: 'r1', token_id: 't1', tenant_id: 'default', method: '', route_pattern: 'dropped:12', status: 0, client_ip: '', created_at: at(0) },
					{ id: 'r2', token_id: 't1', tenant_id: 'default', method: 'GET', route_pattern: '/api/admin/schemas', status: 200, client_ip: '10.0.0.1', created_at: at(0) },
				],
				total: 2,
				limit: 50,
				offset: 0,
			},
		});
		expect(getByText('12 requests not logged (the log queue was full)')).toBeTruthy();
		expect(getByText('/api/admin/schemas')).toBeTruthy();
	});
});
