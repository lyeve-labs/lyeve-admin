// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import DatasourcesPage from './+page.svelte';
import type { Entitlements } from '$lib/entitlements';
import type { Datasource } from '$lib/api/flows';

vi.mock('$app/state', () => ({ page: { url: new URL('http://localhost/admin/flows/datasources') } }));
vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));

afterEach(cleanup);

const licensed: Entitlements = { plan: 'example', state: 'active', features: ['flow'], tenant_quota: 1 };

const warehouse: Datasource = {
	id: 'd1',
	name: 'warehouse',
	kind: 'postgres',
	config: { host: 'db.example.test', port: 5432, database: 'wh', user: 'ro', ssl: 'prefer' },
	has_secret: true,
	allow_writes: false,
	allow_private: false,
	created_at: '2026-09-01T00:00:00Z',
	updated_at: '2026-09-01T00:00:00Z',
};

const inventory: Datasource = {
	...warehouse,
	id: 'd2',
	name: 'inventory',
	kind: 'http',
	config: { base_url: 'https://inventory.example.test', chat_id: '@releases', headers: { Accept: 'application/json', Authorization: '***' } },
	allow_writes: true,
};

function setup(datasources: Datasource[] = [warehouse, inventory], form: unknown = null, locked = false, loadError: string | null = null) {
	return render(DatasourcesPage, {
		props: { data: { datasources, locked, loadError, entitlements: licensed }, form } as never,
	});
}

describe('datasources page', () => {
	it('lists every datasource with its kind, secret, write and private flags', () => {
		const { container } = setup();
		expect(container.textContent).toContain('Beta');
		const rows = container.querySelectorAll('tbody tr');
		expect(rows).toHaveLength(2);
		expect(rows[0].textContent).toContain('Postgres');
		expect(rows[0].textContent).toContain('Stored');
		expect(rows[0].textContent).toContain('read only');
		expect(rows[1].textContent).toContain('HTTP base');
		expect(rows[1].textContent).toContain('allowed');
	});

	it('opens the create drawer with the database fields for the default kind', async () => {
		const { getAllByText, container } = setup([]);
		await fireEvent.click(getAllByText('New datasource')[0]);
		const form = container.querySelector('#datasource-form') as HTMLFormElement;
		expect(form.getAttribute('action')).toBe('?/create');
		expect(form.querySelector('[name="host"]')).toBeTruthy();
		expect((form.querySelector('[name="port"]') as HTMLInputElement).value).toBe('5432');
		expect(form.querySelector('[name="password"]')).toBeTruthy();
		expect(form.querySelector('[name="base_url"]')).toBeNull();
		expect(form.querySelector('[name="chat_id"]')).toBeNull();
		expect((form.querySelector('input[name="ssl"]') as HTMLInputElement).value).toBe('require');
	});

	it('offers the TLS modes of the chosen kind and submits the stored one on edit', async () => {
		const { getByLabelText, container } = setup();
		await fireEvent.click(getByLabelText('Edit warehouse'));
		const form = container.querySelector('#datasource-form') as HTMLFormElement;
		expect((form.querySelector('input[name="ssl"]') as HTMLInputElement).value).toBe('prefer');
		await fireEvent.click(getByLabelText('TLS'));
		const modes = [...container.querySelectorAll('[role="option"]')].map((o) => o.textContent?.trim());
		expect(modes).toEqual(['Require TLS', 'Prefer TLS', 'No TLS']);
	});

	it('opens the edit drawer with the stored config and a per-header secret toggle', async () => {
		const { getByLabelText, container } = setup();
		await fireEvent.click(getByLabelText('Edit inventory'));
		const form = container.querySelector('#datasource-form') as HTMLFormElement;
		expect(form.getAttribute('action')).toBe('?/update');
		expect((form.querySelector('[name="id"]') as HTMLInputElement).value).toBe('d2');
		expect((form.querySelector('[name="base_url"]') as HTMLInputElement).value).toBe('https://inventory.example.test');
		expect((form.querySelector('[name="chat_id"]') as HTMLInputElement).value).toBe('@releases');
		const keys = [...form.querySelectorAll('[name="header_key"]')].map((el) => (el as HTMLInputElement).value);
		expect(keys).toEqual(['Accept', 'Authorization']);
		// The masked header stays secret, so its value field is a blank password input.
		const secrets = [...form.querySelectorAll('[name="header_secret"]')].map((el) => (el as HTMLInputElement).value);
		expect(secrets).toEqual(['false', 'true']);
	});

	async function chooseAuth(container: HTMLElement, label: string) {
		await fireEvent.click(container.querySelector('#ds-auth-type') as HTMLElement);
		await fireEvent.click([...document.querySelectorAll('[role="option"]')].find((o) => o.textContent?.trim() === label) as HTMLElement);
	}

	it('shows the auth section for the http kind, with the fields and a required secret per type', async () => {
		const { getAllByText, container, getByTestId } = setup([]);
		await fireEvent.click(getAllByText('New datasource')[0]);
		await fireEvent.click(container.querySelector('#ds-kind') as HTMLElement);
		await fireEvent.click([...document.querySelectorAll('[role="option"]')].find((o) => o.textContent?.includes('HTTP base')) as HTMLElement);
		const form = container.querySelector('#datasource-form') as HTMLFormElement;
		expect((form.querySelector('[name="chat_id"]') as HTMLInputElement).value).toBe('');
		const section = getByTestId('auth-section');
		expect(section.textContent).toContain('Authentication');
		expect((form.querySelector('input[name="auth_type"]') as HTMLInputElement).value).toBe('none');
		expect(section.textContent).toContain('No credential beyond the headers');

		await chooseAuth(container, 'Bearer token');
		expect((form.querySelector('input[name="auth_type"]') as HTMLInputElement).value).toBe('bearer');
		const token = form.querySelector('[name="auth_token"]') as HTMLInputElement;
		expect(token.type).toBe('password');
		expect(token.required).toBe(true);
		expect(section.textContent).toContain('Encrypted at rest');

		await chooseAuth(container, 'Basic');
		expect((form.querySelector('[name="auth_user"]') as HTMLInputElement).required).toBe(true);
		expect((form.querySelector('[name="auth_password"]') as HTMLInputElement).required).toBe(true);
		expect(form.querySelector('[name="auth_token"]')).toBeNull();

		await chooseAuth(container, 'OAuth2 client credentials');
		expect((form.querySelector('[name="auth_token_url"]') as HTMLInputElement).required).toBe(true);
		expect((form.querySelector('[name="auth_client_id"]') as HTMLInputElement).required).toBe(true);
		expect((form.querySelector('[name="auth_client_secret"]') as HTMLInputElement).required).toBe(true);
		expect(form.querySelector('[name="auth_scopes"]')).toBeTruthy();
		expect(form.querySelector('[name="auth_audience"]')).toBeTruthy();
	});

	it('prefills the stored scheme on edit, lets its secret stay blank, and requires one after a scheme change', async () => {
		const oauth: Datasource = {
			...inventory,
			id: 'd3',
			name: 'weather',
			has_secret: true,
			config: {
				base_url: 'https://weather.example.test',
				auth: { type: 'oauth2_client_credentials', token_url: 'https://auth.example.test/token', client_id: 'cid', scopes: ['read', 'write'], audience: 'https://api' },
			},
		};
		const { getByLabelText, container, getByTestId } = setup([oauth]);
		await fireEvent.click(getByLabelText('Edit weather'));
		const form = container.querySelector('#datasource-form') as HTMLFormElement;
		expect((form.querySelector('input[name="auth_type"]') as HTMLInputElement).value).toBe('oauth2_client_credentials');
		expect((form.querySelector('[name="auth_token_url"]') as HTMLInputElement).value).toBe('https://auth.example.test/token');
		expect((form.querySelector('[name="auth_client_id"]') as HTMLInputElement).value).toBe('cid');
		expect((form.querySelector('[name="auth_scopes"]') as HTMLInputElement).value).toBe('read write');
		expect((form.querySelector('[name="auth_audience"]') as HTMLInputElement).value).toBe('https://api');
		const secret = form.querySelector('[name="auth_client_secret"]') as HTMLInputElement;
		expect(secret.value).toBe('');
		expect(secret.required).toBe(false);
		expect(getByTestId('auth-section').textContent).toContain('Leave blank to keep it');

		await chooseAuth(container, 'Bearer token');
		const token = form.querySelector('[name="auth_token"]') as HTMLInputElement;
		expect(token.required).toBe(true);
		expect(getByTestId('auth-section').textContent).toContain('The scheme changed');
	});

	it('requires the secret on edit when the stored datasource holds none for that scheme', async () => {
		// inventory has a secret header but no auth block, so a bearer token is a new secret.
		const { getByLabelText, container, getByTestId } = setup([inventory]);
		await fireEvent.click(getByLabelText('Edit inventory'));
		await chooseAuth(container, 'Bearer token');
		const form = container.querySelector('#datasource-form') as HTMLFormElement;
		expect((form.querySelector('[name="auth_token"]') as HTMLInputElement).required).toBe(true);
		expect(getByTestId('auth-section').textContent).not.toContain('Leave blank');
	});

	it('shows the test result beside the row it was run for', () => {
		const { container } = setup([warehouse, inventory], { testResult: { id: 'd1', ok: true, latency_ms: 8, error: '' } });
		const rows = container.querySelectorAll('tbody tr');
		expect(rows[0].textContent).toContain('connected');
		expect(rows[0].textContent).toContain('8 ms');
		expect(rows[1].textContent).toContain('not tested');
	});

	it('shows the error a failed test carried', () => {
		const { container } = setup([warehouse], { testResult: { id: 'd1', ok: false, latency_ms: 0, error: 'connection refused' } });
		expect(container.textContent).toContain('connection refused');
	});

	it('never posts a delete straight from the row', () => {
		const { container, getByLabelText } = setup();
		expect(getByLabelText('Delete warehouse')).toBeTruthy();
		const form = container.querySelector('form[action="?/delete"]') as HTMLFormElement;
		expect((form.querySelector('[name="id"]') as HTMLInputElement).value).toBe('');
	});

	it('shows a failed load as an alert and not as an empty list', () => {
		const { container, queryByText } = setup([], null, false, 'Datasources could not be read from the engine.');
		expect(container.textContent).toContain('Datasources could not be read from the engine.');
		expect(queryByText('No datasources yet')).toBeNull();
	});

	it('renders the not-enabled state when locked', () => {
		const { getByTestId } = setup([], null, true);
		expect(getByTestId('not-enabled')).toBeTruthy();
	});
});

describe('datasources page when the plugin says they are not enabled', () => {
	function unavailable(datasources: Datasource[] = [], form: unknown = null) {
		return render(DatasourcesPage, {
			props: { data: { datasources, available: false, locked: false, loadError: null, entitlements: licensed }, form } as never,
		});
	}

	it('says so in place of the empty state and disables create', () => {
		const { getAllByTestId, getAllByText, queryByText } = unavailable();
		const notice = getAllByTestId('not-enabled');
		expect(notice).toHaveLength(1);
		expect(notice[0].textContent).toContain('Datasources');
		expect(notice[0].textContent).toContain('Not enabled on this instance.');
		expect(queryByText('No datasources yet')).toBeNull();
		const create = getAllByText('New datasource')[0].closest('button') as HTMLButtonElement;
		expect(create.disabled).toBe(true);
	});

	it('lists the stored rows and says it once, in the header', () => {
		const { getAllByTestId, getByText } = unavailable([warehouse]);
		expect(getByText('warehouse')).toBeTruthy();
		expect(getAllByTestId('not-enabled')).toHaveLength(1);
	});

	it('renders a refused write as not enabled, naming no capability', () => {
		const { container } = unavailable([], { error: 'Datasources are not enabled on this instance, so nothing was changed.', refused: true });
		expect(container.textContent).toContain('Datasources are not enabled on this instance, so nothing was changed.');
		expect(container.textContent).not.toMatch(/capability|license/i);
	});

	it('keeps the ordinary empty state and an enabled create when they are enabled', () => {
		const { queryByTestId, getAllByText, getByText } = setup([]);
		expect(queryByTestId('not-enabled')).toBeNull();
		expect(getByText('No datasources yet')).toBeTruthy();
		const create = getAllByText('New datasource')[0].closest('button') as HTMLButtonElement;
		expect(create.disabled).toBe(false);
	});
});

// A chat channel is a datasource and nothing else: the webhook or the bot API
// this page already stores.
describe('datasources page chat channels', () => {
	it('points chat at the flow node and its template', () => {
		const text = (setup().container.textContent ?? '').replace(/\s+/g, ' ');
		expect(text).toContain('chat.notify');
		expect(text).toContain('chat-notify');
		expect(text).toContain('Slack, Discord and Telegram');
	});

	it('warns that EVENT_BUS never names a chat service', () => {
		const text = (setup().container.textContent ?? '').replace(/\s+/g, ' ');
		expect(text).toContain('EVENT_BUS');
		expect(text).toContain('stop the engine from starting');
	});
});
