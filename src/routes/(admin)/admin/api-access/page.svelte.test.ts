// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Page from './+page.svelte';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));

afterEach(cleanup);

function setup(roles: string[]) {
	const data = { user: { id: 'u1', email: 'me@b.test', roles } };
	return render(Page, { props: { data, form: null } as never });
}

describe('API access page', () => {
	it('links the Users page only for a super admin, who is the one that opens it', () => {
		const admin = setup(['admin']);
		expect(admin.queryByRole('link', { name: 'Users' })).toBeNull();
		admin.unmount();

		const superAdmin = setup(['super_admin']);
		expect(superAdmin.getByRole('link', { name: 'Users' }).getAttribute('href')).toBe('/admin/users');
	});
});
