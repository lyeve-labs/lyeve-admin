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

	it('shows a refused save inside the open drawer', async () => {
		const { getByRole } = setup([provider('google')], { error: 'The provider could not be saved.' });
		await fireEvent.click(getByRole('button', { name: 'New provider' }));
		const form = document.body.querySelector('form#provider-form');
		expect(form?.textContent).toContain('The provider could not be saved.');
	});
});
