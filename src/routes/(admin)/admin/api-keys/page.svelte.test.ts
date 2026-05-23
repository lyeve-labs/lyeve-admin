// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Page from './+page.svelte';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));
vi.mock('$app/navigation', () => ({ goto: vi.fn(), invalidateAll: vi.fn() }));
vi.mock('$app/state', () => ({ page: { url: new URL('http://admin/admin/api-keys') } }));

afterEach(cleanup);

function key(over: Record<string, unknown>) {
	return {
		id: 'k1',
		name: 'deploy',
		prefix: 'ly_abcd',
		roles: ['editor'],
		schemas: [],
		enabled: true,
		created_at: '2026-09-01T00:00:00Z',
		expires_at: '2026-11-01T00:00:00Z',
		...over,
	};
}

function setup(keys: unknown[]) {
	const data = {
		keys,
		usageMap: {},
		month: '2026-10',
		total: keys.length,
		limit: 50,
		offset: 0,
		schemaNames: ['pages', 'posts'],
		catalog: {
			actions: ['read', 'create', 'update', 'delete'],
			routes: [
				{ method: 'POST', path: '/api/v1/flows/{slug}', resource: 'flows', name: '{slug}', action: 'create', scope: 'flows.{slug}:create', owner: 'flow' },
				{ method: 'POST', path: '/api/v1/graphql', resource: 'graphql', action: 'read', scope: 'graphql:read', owner: 'graphql', declared: true },
			],
		},
	};
	return render(Page, { props: { data, form: null } as never });
}

describe('API keys page', () => {
	it('says the admin API refuses a key with an admin role', () => {
		const { container, getByText } = setup([key({ roles: ['admin'] })]);
		expect(container.textContent).toContain('The admin API refuses a key with an admin role.');
		expect(container.textContent).toContain('These keys still work on the content API.');
		expect(getByText('Admin API: refused')).toBeTruthy();
	});

	it('raises nothing for a key without an admin role', () => {
		const { container } = setup([key({ roles: ['editor'] })]);
		expect(container.textContent).not.toContain('admin API refuses');
		expect(container.textContent).not.toContain('Admin API: refused');
	});

	it('shows the scopes each key holds, one resource a line', () => {
		const { container } = setup([
			key({ scopes: ['content.posts:read', 'content.posts:create', 'schemas:read'] }),
			key({ id: 'k2', name: 'old', scopes: [] }),
		]);
		expect(container.textContent).toContain('content.posts: read, create');
		expect(container.textContent).toContain('schemas: read');
		expect(container.textContent).toContain('none');
	});

	it('shows the hourly and daily ceilings beside the usage', () => {
		const { container } = setup([key({ hourly_limit: 60, daily_limit: 1000 })]);
		expect(container.textContent).toMatch(/Also 60\/h, 1,?000\/day/);
	});

	const sent = (name: string) =>
		[...document.body.querySelectorAll<HTMLInputElement>(`input[type="hidden"][name="${name}"]`)].map((i) => i.value);

	it('starts a new key able to read every schema and discover them', async () => {
		const { getAllByRole } = setup([key({})]);
		await fireEvent.click(getAllByRole('button', { name: /New key/ })[0]);
		expect(sent('scopes')).toEqual(['content:read', 'schemas:read']);
		expect(sent('schemas')).toEqual([]);
	});

	it('holds a key to the schemas and actions ticked for each', async () => {
		const { getAllByRole, getByRole, getByLabelText } = setup([key({})]);
		await fireEvent.click(getAllByRole('button', { name: /New key/ })[0]);
		await fireEvent.click(getByRole('radio', { name: 'Chosen schemas' }));
		await fireEvent.click(getByLabelText('Read posts'));
		await fireEvent.click(getByLabelText('Create posts'));
		expect(sent('scopes')).toEqual(['content.posts:read', 'content.posts:create', 'schemas:read']);
		expect(sent('schemas')).toEqual(['posts']);
	});

	it('offers each route group the engine lists, with its routes', async () => {
		const { getAllByRole, getByRole } = setup([key({})]);
		await fireEvent.click(getAllByRole('button', { name: /New key/ })[0]);
		await fireEvent.click(getByRole('button', { name: /Flows/ }));
		expect(document.body.textContent).toContain('/api/v1/flows/{slug}');
		expect(document.body.querySelector('#key-names-flows')).toBeTruthy();
	});

	it('warns that GraphQL reads every schema when the key is held to some', async () => {
		const { getAllByRole, getByRole } = setup([key({})]);
		await fireEvent.click(getAllByRole('button', { name: /New key/ })[0]);
		await fireEvent.click(getByRole('button', { name: /GraphQL/ }));
		expect(document.body.textContent).not.toContain('reads every schema, whichever schemas are chosen');
		await fireEvent.click(getByRole('radio', { name: 'Chosen schemas' }));
		expect(document.body.textContent).toContain('GraphQL reads every schema, whichever schemas are chosen above.');
	});

	it('flags a flow name that cannot be part of a scope', async () => {
		const { getAllByRole, getByRole } = setup([key({})]);
		await fireEvent.click(getAllByRole('button', { name: /New key/ })[0]);
		await fireEvent.click(getByRole('button', { name: /Flows/ }));
		const names = document.body.querySelector<HTMLInputElement>('#key-names-flows')!;
		await fireEvent.input(names, { target: { value: 'order sync' } });
		expect(document.body.textContent).toContain('"order sync" cannot name an endpoint.');
	});

	it('edits a key\'s limits in a drawer with all three windows', async () => {
		const { getByRole } = setup([key({ monthly_limit: 900, daily_limit: 90, hourly_limit: 9 })]);
		await fireEvent.click(getByRole('button', { name: 'Request limits for deploy' }));
		const value = (id: string) => document.body.querySelector<HTMLInputElement>(`#${id}`)?.value;
		expect([value('key-limit-hourly_limit'), value('key-limit-daily_limit'), value('key-limit-monthly_limit')]).toEqual(['9', '90', '900']);
	});
});
