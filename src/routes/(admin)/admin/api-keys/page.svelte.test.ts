// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Page from './+page.svelte';

/*
 * enhance hands each form's submit function over here, so a test can run the
 * one behind a delete and read the question it asks.
 */
const forms = vi.hoisted(() => ({ submits: [] as { node: HTMLFormElement; submit: unknown }[] }));
vi.mock('$app/forms', () => ({
	enhance: (node: HTMLFormElement, submit?: unknown) => {
		forms.submits.push({ node, submit });
		return { destroy: () => {} };
	},
}));
const kit = vi.hoisted(() => ({ confirm: vi.fn(async () => false) }));
vi.mock('@lyeve-labs/ui-kit', async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	confirm: kit.confirm,
}));

/** The title of the question the first delete form on the page asks. */
async function deleteTitle(): Promise<string> {
	const entry = forms.submits.find((f) => f.node.getAttribute('action') === '?/delete' && f.node.isConnected);
	const submit = entry?.submit as ((input: { cancel: () => void }) => Promise<unknown>) | undefined;
	if (!submit) throw new Error('no delete form registered a submit function');
	kit.confirm.mockClear();
	await submit({ cancel: () => {} });
	return String((kit.confirm.mock.calls[0] as unknown[] | undefined)?.[0] ?? '');
}
vi.mock('$app/navigation', () => ({ goto: vi.fn(), invalidateAll: vi.fn() }));
vi.mock('$app/state', () => ({ page: { url: new URL('http://admin/admin/api-keys') } }));

afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

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

function setup(keys: unknown[] | { ok: false; gate: unknown }, over: Record<string, unknown> = {}, form: unknown = null) {
	const data = {
		keys: Array.isArray(keys) ? { ok: true, value: keys } : keys,
		usageMap: {},
		usageUnknown: [],
		catalogFailed: false,
		schemasFailed: false,
		month: '2026-10',
		total: Array.isArray(keys) ? keys.length : 0,
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
		...over,
	};
	return render(Page, { props: { data, form } as never });
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

	it('says the keys could not be read instead of inviting a first key', () => {
		const { container, queryByRole } = setup({ ok: false, gate: { state: 'error', message: 'The API keys could not be read.' } });
		expect(container.textContent).toContain('The API keys could not be read.');
		expect(container.textContent).not.toContain('No API keys yet');
		expect(queryByRole('button', { name: /New key/ })).toBeNull();
	});

	it('keeps the pager when nothing on this page matches the search', async () => {
		const { container, getByPlaceholderText } = setup([key({})], { total: 120, offset: 0, limit: 50 });
		await fireEvent.input(getByPlaceholderText('Name, role or schema on this page'), { target: { value: 'nothing like it' } });
		expect(container.textContent).toContain('No key on this page matches');
		expect(container.querySelector('a[href="/admin/api-keys?limit=50&offset=50"]')).toBeTruthy();
	});

	it('says the usage is unknown when its read failed, not that there was none', () => {
		const { container } = setup([key({})], { usageUnknown: ['k1'] });
		expect(container.textContent).toContain('Unknown, the usage could not be read');
	});

	it('says in the drawer that the schemas could not be read', async () => {
		const { getAllByRole, getByRole } = setup([key({})], { schemaNames: [], schemasFailed: true });
		await fireEvent.click(getAllByRole('button', { name: /New key/ })[0]);
		await fireEvent.click(getByRole('radio', { name: 'Chosen schemas' }));
		expect(document.body.textContent).toContain('The schemas could not be read');
		expect(document.body.textContent).not.toContain('This instance has no schemas yet');
	});

	it('names the key in the delete confirmation', async () => {
		setup([key({})]);
		expect(await deleteTitle()).toBe('Delete API key deploy');
	});

	it('shows the new key once in a field that copies it and confirms', async () => {
		vi.useFakeTimers();
		const writeText = vi.fn(async (_text: string) => {});
		Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
		setup([key({})], {}, { created: true, raw_key: 'ly_live_secret', key_name: 'deploy' });

		expect((screen.getByLabelText('API key') as HTMLInputElement).value).toBe('ly_live_secret');
		await fireEvent.click(screen.getByRole('button', { name: 'Copy key' }));
		await vi.advanceTimersByTimeAsync(0);
		expect(writeText).toHaveBeenCalledWith('ly_live_secret');
		expect(screen.getByText('Copied')).toBeTruthy();

		await vi.advanceTimersByTimeAsync(1500);
		expect(screen.queryByText('Copied')).toBeNull();
	});

	it('keeps the way to copy the key by hand after a copy fails', async () => {
		vi.useFakeTimers();
		const writeText = vi.fn(async (_text: string) => {
			throw new Error('denied');
		});
		Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
		Object.defineProperty(document, 'execCommand', { value: vi.fn(() => false), configurable: true });
		setup([key({})], {}, { created: true, raw_key: 'ly_live_secret', key_name: 'deploy' });
		const hint = 'If the copy fails, select the key and copy it yourself.';

		await fireEvent.click(screen.getByRole('button', { name: 'Copy key' }));
		await vi.advanceTimersByTimeAsync(0);
		expect(screen.getByText('Copy failed')).toBeTruthy();

		await vi.advanceTimersByTimeAsync(1500);
		expect(screen.queryByText('Copy failed')).toBeNull();
		expect(screen.getByText(hint)).toBeTruthy();
	});
});
