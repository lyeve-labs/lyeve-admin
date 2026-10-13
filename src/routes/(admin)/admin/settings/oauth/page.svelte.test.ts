// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Page from './+page.svelte';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));

afterEach(cleanup);

const provider = (name: string, enabled = true) => ({
	id: name,
	name,
	client_id: `${name}-client`,
	issuer_url: `https://${name}.example.com`,
	scopes: ['openid', 'email'],
	roles_claim: 'roles',
	default_roles: ['editor'],
	enabled,
});

function setup(providers: ReturnType<typeof provider>[] | { ok: false; gate: unknown }, form: unknown = null) {
	const read = Array.isArray(providers) ? { ok: true, value: providers } : providers;
	return render(Page, { props: { data: { providers: read }, form } as never });
}

describe('OAuth providers page', () => {
	it('lists providers in a table with the sign-in path each one serves', () => {
		const { container, getByText } = setup([provider('google'), provider('github', false)]);
		expect(container.querySelectorAll('tbody tr')).toHaveLength(2);
		expect(getByText('/api/admin/auth/oauth/google')).toBeTruthy();
		expect(getByText('Disabled')).toBeTruthy();
	});

	it('names the API path in the form hint, where sign-in starts', async () => {
		const { getByRole, getByText } = setup([provider('google')]);
		await fireEvent.click(getByRole('button', { name: 'New provider' }));
		expect(getByText(/google gives \/api\/admin\/auth\/oauth\/google\./)).toBeTruthy();
	});

	it('narrows the list by name or issuer', async () => {
		const { container, getByPlaceholderText } = setup([provider('google'), provider('github')]);
		await fireEvent.input(getByPlaceholderText('Search providers'), { target: { value: 'git' } });
		expect(container.querySelectorAll('tbody tr')).toHaveLength(1);
	});

	it('says the providers could not be read instead of inviting a first one', () => {
		const { container, queryByRole } = setup({ ok: false, gate: { state: 'error', message: 'The OAuth providers could not be read.' } });
		expect(container.textContent).toContain('The OAuth providers could not be read.');
		expect(container.textContent).not.toContain('No OAuth providers configured');
		expect(queryByRole('button', { name: 'New provider' })).toBeNull();
	});

	const drawerText = () => document.body.querySelector('form#provider-form')?.textContent ?? '';

	it('shows a refused save inside the open drawer', async () => {
		const { getByRole, rerender } = setup([provider('google')]);
		await fireEvent.click(getByRole('button', { name: 'New provider' }));
		await rerender({ data: { providers: { ok: true, value: [provider('google')] } }, form: { action: 'create', error: 'The provider could not be created.' } } as never);
		expect(drawerText()).toContain('The provider could not be created.');
	});

	it('leaves a newly opened drawer clean after a failed delete', async () => {
		const { container, getByRole } = setup([provider('google')], { action: 'delete', error: 'The provider could not be deleted.' });
		expect(container.textContent).toContain('The provider could not be deleted.');
		await fireEvent.click(getByRole('button', { name: 'New provider' }));
		expect(drawerText()).not.toContain('could not be deleted');
	});

	it('shows a license refusal of a save in the drawer, not above the list', async () => {
		const refused = { kind: 'feature', feature: 'OAuth sign-in', plugin: 'oauth', upgradeUrl: '' };
		const { container, getByRole, rerender } = setup([provider('google')]);
		await fireEvent.click(getByRole('button', { name: 'New provider' }));
		await rerender({ data: { providers: { ok: true, value: [provider('google')] } }, form: { action: 'create', error: 'Not enabled.', refused } } as never);
		expect(drawerText()).toContain('OAuth sign-in');
		expect(container.textContent?.split('This needs OAuth sign-in').length).toBe(2);
	});

});
