import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Cookies } from '@sveltejs/kit';

vi.mock('@lyeve-labs/client', () => {
	return {
		createClient: vi.fn(),
		ApiError: class ApiError extends Error {
			status: number;
			constructor(status: number, message: string) {
				super(message);
				this.status = status;
			}
		},
	};
});

import { load, actions } from './+page.server';
import { createClient, ApiError } from '@lyeve-labs/client';

function mockCookies(initial: Record<string, string> = {}): Cookies {
	const store = { ...initial };
	return {
		get: vi.fn((name: string) => store[name] ?? undefined),
		set: vi.fn(),
		delete: vi.fn(),
		getAll: vi.fn(() => []),
		serialize: vi.fn(() => ''),
	} as unknown as Cookies;
}

const authed = () => mockCookies({ '__Host-sys_session': 'token' });

function request(fields: Record<string, string>): Request {
	const data = new FormData();
	for (const [k, v] of Object.entries(fields)) data.append(k, v);
	return { formData: async () => data } as unknown as Request;
}

const mockedCreateClient = vi.mocked(createClient);

beforeEach(() => {
	vi.clearAllMocks();
});

describe('configuration load', () => {
	it('returns nothing without a session', async () => {
		const result = await load({ fetch: vi.fn(), cookies: mockCookies() } as never);
		expect(result).toEqual({ provenance: null });
		expect(mockedCreateClient).not.toHaveBeenCalled();
	});

	it('returns the provenance report', async () => {
		const provenance = {
			settings: [{ key: 'STORAGE_DRIVER', source: 'file', value: 'local', editable: true }],
			counts: { file: 1 },
		};
		mockedCreateClient.mockReturnValue({ get: vi.fn(async () => provenance) } as never);

		const result = await load({ fetch: vi.fn(), cookies: authed(), url: new URL('http://admin.test/admin/settings/configuration') } as never);
		expect(result).toEqual({ provenance, plugin: null });
	});

	// The page renders a read-only notice rather than failing: a session that
	// is not super admin gets 403 here, and that is a normal state.
	it('returns nothing when the report cannot be read', async () => {
		mockedCreateClient.mockReturnValue({
			get: vi.fn(async () => {
				throw new ApiError(403, 'forbidden');
			}),
		} as never);

		const result = await load({ fetch: vi.fn(), cookies: authed(), url: new URL('http://admin.test/admin/settings/configuration') } as never);
		expect(result).toEqual({ provenance: null, plugin: null });
	});

	// Opened for one plugin, the list gains the keys its schema declares that
	// nothing has read yet, and names which keys belong to the plugin.
	it('scopes the list to a plugin and adds its unread settings', async () => {
		const provenance = { settings: [{ key: 'SMTP_HOST', source: 'env', value: 'mail', editable: false }], counts: { env: 1 } };
		const get = vi.fn(async (path: string) => {
			if (path === '/api/admin/config') return provenance;
			return { type: 'object', properties: { smtp_host: { description: 'Relay host.' }, smtp_port: { default: 587 } } };
		});
		mockedCreateClient.mockReturnValue({ get } as never);
		const result = (await load({ fetch: vi.fn(), cookies: authed(), url: new URL('http://admin.test/x?plugin=email') } as never)) as {
			provenance: { settings: { key: string; source: string }[] };
			plugin: { name: string; keys: string[]; found: boolean };
		};
		expect(result.plugin).toEqual({ name: 'email', keys: ['SMTP_HOST', 'SMTP_PORT'], found: true });
		expect(result.provenance.settings.map((s) => [s.key, s.source])).toEqual([['SMTP_HOST', 'env'], ['SMTP_PORT', 'default']]);
	});
});

describe('configuration save', () => {
	it('sends one setting', async () => {
		const put = vi.fn(async () => ({ saved: [{ key: 'STORAGE_DRIVER' }] }));
		mockedCreateClient.mockReturnValue({ put } as never);

		const result = await actions.save({
			request: request({ key: 'STORAGE_DRIVER', value: 's3', secret: 'false' }),
			fetch: vi.fn(),
			cookies: authed(),
		} as never);

		expect(put).toHaveBeenCalledWith('/api/admin/config', {
			values: { STORAGE_DRIVER: 's3' },
		});
		expect(result).toEqual({ success: true, key: 'STORAGE_DRIVER' });
	});

	// A blank secret is how the engine is told to unset one, so an empty
	// submission is refused here rather than silently clearing the credential.
	it('refuses to submit a blank credential', async () => {
		const put = vi.fn();
		mockedCreateClient.mockReturnValue({ put } as never);

		const result = await actions.save({
			request: request({ key: 'SMTP_PASS', value: '', secret: 'true' }),
			fetch: vi.fn(),
			cookies: authed(),
		} as never);

		expect(put).not.toHaveBeenCalled();
		expect(result).toMatchObject({ status: 400 });
	});

	it('reports a refusal with the layer that holds the key', async () => {
		mockedCreateClient.mockReturnValue({
			put: vi.fn(async () => ({
				refused: [{ key: 'APP_ENV', reason: 'pinned by the configuration file', origin: 'lyeve.yaml:3' }],
			})),
		} as never);

		const result = (await actions.save({
			request: request({ key: 'APP_ENV', value: 'development', secret: 'false' }),
			fetch: vi.fn(),
			cookies: authed(),
		} as never)) as { status: number; data: { error: string } };

		expect(result.status).toBe(409);
		expect(result.data.error).toContain('lyeve.yaml:3');
	});

	it('requires a session', async () => {
		const result = await actions.save({
			request: request({ key: 'STORAGE_DRIVER', value: 's3' }),
			fetch: vi.fn(),
			cookies: mockCookies(),
		} as never);
		expect(result).toMatchObject({ status: 401 });
	});

	it('requires a setting name', async () => {
		const result = await actions.save({
			request: request({ value: 's3' }),
			fetch: vi.fn(),
			cookies: authed(),
		} as never);
		expect(result).toMatchObject({ status: 400 });
	});
});
