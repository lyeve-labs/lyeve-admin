import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Cookies } from '@sveltejs/kit';

// Mock the client modules before importing the load function.
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

vi.mock('@lyeve-labs/client-rest', () => {
	return {
		getEntitlements: vi.fn(),
		getMe: vi.fn(),
	};
});

import { load } from './+page.server';
import { createClient, ApiError } from '@lyeve-labs/client';
import type { Entitlements } from '$lib/entitlements';
import { getEntitlements, getMe } from '@lyeve-labs/client-rest';

interface CookieStore {
	[key: string]: string;
}

function mockCookies(initial: CookieStore = {}): Cookies {
	const store = { ...initial };
	return {
		get: vi.fn((name: string) => store[name] ?? undefined),
		set: vi.fn(),
		delete: vi.fn(),
		getAll: vi.fn(() => []),
		serialize: vi.fn(() => ''),
	} as unknown as Cookies;
}

function mockFetch(json: unknown, status = 200): typeof globalThis.fetch {
	return vi.fn(async (_url: string, _init?: RequestInit) => {
		return new Response(JSON.stringify(json), {
			status,
			headers: { 'content-type': 'application/json' },
		});
	}) as unknown as typeof globalThis.fetch;
}

const mockedCreateClient = vi.mocked(createClient);
const mockedGetEntitlements = vi.mocked(getEntitlements);
const mockedGetMe = vi.mocked(getMe);

function sessionUser(roles: string[]) {
	return {
		id: 'u1',
		email: 'ops@example.com',
		roles,
		tenant_id: 'default',
		disabled: false,
		created_at: '2026-01-01T00:00:00Z',
	} as never;
}

beforeEach(() => {
	vi.clearAllMocks();
	mockedGetMe.mockResolvedValue(sessionUser(['super_admin']));
});

interface LoadResult {
	entitlements: Entitlements | null;
}

/** One load, for a reader with these roles, holding a session. */
function loadEvent(roles: string[]) {
	return {
		fetch: mockFetch({}),
		cookies: mockCookies({ '__Host-sys_session': 'valid-token' }),
		parent: async () => ({ user: sessionUser(roles) }),
	} as never;
}

describe('license +page.server.ts load', () => {
	it('returns the entitlements to an admin', async () => {
		const entitlements = {
			plan: 'example',
			plan_label: 'Example',
			state: 'active',
			features: ['example'],
			tenant_quota: 0,
			license_module: true,
		};
		const mockClient = {};
		mockedCreateClient.mockReturnValue(mockClient as never);
		// The mock takes the SDK's return type, which does not declare every
		// field the engine sends.
		mockedGetEntitlements.mockResolvedValue(entitlements as never);

		const result = (await load(loadEvent(['admin']))) as LoadResult;

		expect(result).toEqual({ entitlements });
		expect(mockedGetEntitlements).toHaveBeenCalledWith(mockClient);
	});

	// The engine gives the entitlements to no one else, so the page would have
	// nothing true to show.
	it('refuses a reader below admin without asking the engine', async () => {
		mockedCreateClient.mockReturnValue({} as never);

		await expect(load(loadEvent(['editor']))).rejects.toMatchObject({ status: 403 });
		expect(mockedGetEntitlements).not.toHaveBeenCalled();
	});

	it('is not there on a build that links no license module', async () => {
		mockedCreateClient.mockReturnValue({} as never);
		mockedGetEntitlements.mockResolvedValue({
			plan: 'free',
			state: 'free',
			features: [],
			tenant_quota: 0,
			license_module: false,
		} as never);

		await expect(load(loadEvent(['super_admin']))).rejects.toMatchObject({ status: 404 });
	});

	it('keeps the page on an engine that does not say whether it links one', async () => {
		const entitlements = { plan: 'example', state: 'active', features: [], tenant_quota: 0 };
		mockedCreateClient.mockReturnValue({} as never);
		mockedGetEntitlements.mockResolvedValue(entitlements as never);

		const result = (await load(loadEvent(['super_admin']))) as LoadResult;

		expect(result.entitlements).toEqual(entitlements);
	});

	it('returns null entitlements when getEntitlements throws', async () => {
		mockedGetEntitlements.mockRejectedValue(new Error('connection refused'));
		mockedCreateClient.mockReturnValue({} as never);

		const result = (await load(loadEvent(['super_admin']))) as LoadResult;

		expect(result.entitlements).toBeNull();
	});

	it('reads entitlements without calling any other engine endpoint', async () => {
		const entitlements = { plan: 'example', state: 'active', features: [], tenant_quota: 0, license_module: true };
		mockedGetEntitlements.mockResolvedValue(entitlements as never);

		const get = vi.fn();
		const post = vi.fn();
		mockedCreateClient.mockReturnValue({ get, post } as never);

		const result = (await load(loadEvent(['super_admin']))) as LoadResult;

		expect(result.entitlements).toEqual(entitlements);
		expect(get).not.toHaveBeenCalled();
		expect(post).not.toHaveBeenCalled();
	});
});

describe('license +page.server.ts actions.renew', () => {
	it('returns 401 when no session cookie', async () => {
		const { actions } = await import('./+page.server');
		const cookies = mockCookies();
		const fetch = mockFetch({});

		const request = new Request('http://localhost/admin/settings/license?/renew', {
			method: 'POST',
			body: new FormData(),
		});

		const result = await actions.renew({ request, fetch, cookies } as never);
		expect(result).toMatchObject({ status: 401, data: { error: 'Not authenticated' } });
	});

	it('returns 400 when license_key is empty', async () => {
		const { actions } = await import('./+page.server');
		const cookies = mockCookies({ '__Host-sys_session': 'valid' });
		const fetch = mockFetch({});

		const formData = new FormData();
		const request = new Request('http://localhost/admin/settings/license?/renew', {
			method: 'POST',
			body: formData,
		});

		mockedCreateClient.mockReturnValue({} as never);

		const result = await actions.renew({ request, fetch, cookies } as never);
		expect(result).toMatchObject({ status: 400, data: { error: 'License key is required' } });
	});

	it('returns success on valid renewal', async () => {
		const { actions } = await import('./+page.server');
		const entitlements: Entitlements = {
			plan: 'example',
			state: 'active',
			features: ['example'],
			tenant_quota: 0,
		};
		const mockClient = {
			post: vi.fn(async () => entitlements),
		};
		mockedCreateClient.mockReturnValue(mockClient as never);

		const cookies = mockCookies({ '__Host-sys_session': 'valid' });
		const fetch = mockFetch({});

		const formData = new FormData();
		formData.set('license_key', 'valid-license-key');
		const request = new Request('http://localhost/admin/settings/license?/renew', {
			method: 'POST',
			body: formData,
		});

		const result = await actions.renew({ request, fetch, cookies } as never);
		expect(result).toEqual({ success: true, ...entitlements });
	});

	it('posts the pasted key to the license renew endpoint', async () => {
		const { actions } = await import('./+page.server');
		const post = vi.fn(async () => ({}));
		mockedCreateClient.mockReturnValue({ post } as never);

		const cookies = mockCookies({ '__Host-sys_session': 'valid' });
		const fetch = mockFetch({});

		const formData = new FormData();
		formData.set('license_key', 'example-token');
		const request = new Request('http://localhost/admin/settings/license?/renew', {
			method: 'POST',
			body: formData,
		});

		await actions.renew({ request, fetch, cookies } as never);
		expect(post).toHaveBeenCalledWith('/api/admin/license/renew', {
			license_key: 'example-token',
		});
	});

	// Keys are pasted by hand, so they arrive padded.
	it('trims whitespace around a pasted key', async () => {
		const { actions } = await import('./+page.server');
		const post = vi.fn(async () => ({}));
		mockedCreateClient.mockReturnValue({ post } as never);

		const cookies = mockCookies({ '__Host-sys_session': 'valid' });
		const fetch = mockFetch({});

		const formData = new FormData();
		formData.set('license_key', '  example-token\n');
		const request = new Request('http://localhost/admin/settings/license?/renew', {
			method: 'POST',
			body: formData,
		});

		await actions.renew({ request, fetch, cookies } as never);
		expect(post).toHaveBeenCalledWith('/api/admin/license/renew', {
			license_key: 'example-token',
		});
	});

	it('rejects a key that is only whitespace', async () => {
		const { actions } = await import('./+page.server');
		mockedCreateClient.mockReturnValue({} as never);

		const cookies = mockCookies({ '__Host-sys_session': 'valid' });
		const fetch = mockFetch({});

		const formData = new FormData();
		formData.set('license_key', '   ');
		const request = new Request('http://localhost/admin/settings/license?/renew', {
			method: 'POST',
			body: formData,
		});

		const result = await actions.renew({ request, fetch, cookies } as never);
		expect(result).toMatchObject({ status: 400, data: { error: 'License key is required' } });
	});

	it('returns error on ApiError', async () => {
		const { actions } = await import('./+page.server');
		const mockClient = {
			post: vi.fn(async () => {
				throw new ApiError(422, 'Invalid license key');
			}),
		};
		mockedCreateClient.mockReturnValue(mockClient as never);

		const cookies = mockCookies({ '__Host-sys_session': 'valid' });
		const fetch = mockFetch({});

		const formData = new FormData();
		formData.set('license_key', 'invalid-key');
		const request = new Request('http://localhost/admin/settings/license?/renew', {
			method: 'POST',
			body: formData,
		});

		const result = await actions.renew({ request, fetch, cookies } as never);
		expect(result).toMatchObject({ status: 422, data: { error: 'Invalid license key' } });
	});

	it('returns 500 when the engine fails in a way the client does not classify', async () => {
		const { actions } = await import('./+page.server');
		const mockClient = {
			post: vi.fn(async () => {
				throw new Error('connection refused');
			}),
		};
		mockedCreateClient.mockReturnValue(mockClient as never);

		const cookies = mockCookies({ '__Host-sys_session': 'valid' });
		const fetch = mockFetch({});

		const formData = new FormData();
		formData.set('license_key', 'some-key');
		const request = new Request('http://localhost/admin/settings/license?/renew', {
			method: 'POST',
			body: formData,
		});

		const result = await actions.renew({ request, fetch, cookies } as never);
		expect(result).toMatchObject({ status: 500, data: { error: 'Renewal failed' } });
	});
});

describe('license +page.server.ts actions.renew with a license key', () => {
	function renewRequest(key: string) {
		const formData = new FormData();
		formData.set('license_key', key);
		return new Request('http://localhost/admin/settings/license?/renew', {
			method: 'POST',
			body: formData,
		});
	}

	// A license key relicenses the whole install, so a tenant admin never
	// reaches the engine with one.
	it('refuses a renewal from an admin who is not a super admin', async () => {
		const { actions } = await import('./+page.server');
		mockedGetMe.mockResolvedValue(sessionUser(['admin']));
		const post = vi.fn();
		mockedCreateClient.mockReturnValue({ post } as never);

		const cookies = mockCookies({ '__Host-sys_session': 'valid' });
		await expect(
			actions.renew({ request: renewRequest('example-key'), fetch: mockFetch({}), cookies } as never)
		).rejects.toMatchObject({ status: 403 });
		expect(post).not.toHaveBeenCalled();
	});

	it('posts a license key to the same renew endpoint', async () => {
		const { actions } = await import('./+page.server');
		const post = vi.fn(async () => ({}));
		mockedCreateClient.mockReturnValue({ post } as never);

		const cookies = mockCookies({ '__Host-sys_session': 'valid' });
		await actions.renew({ request: renewRequest(' example-key\n'), fetch: mockFetch({}), cookies } as never);
		expect(post).toHaveBeenCalledWith('/api/admin/license/renew', { license_key: 'example-key' });
	});

	it('returns the plan, source and expiry the engine reports', async () => {
		const { actions } = await import('./+page.server');
		const answer = {
			plan: 'example',
			state: 'active',
			features: ['example'],
			license_source: 'example-source',
			expires_at: '2026-10-24T00:00:00Z',
		};
		mockedCreateClient.mockReturnValue({ post: vi.fn(async () => answer) } as never);

		const cookies = mockCookies({ '__Host-sys_session': 'valid' });
		const result = await actions.renew({
			request: renewRequest('example-key'),
			fetch: mockFetch({}),
			cookies,
		} as never);
		expect(result).toEqual({ success: true, ...answer });
	});

	it('passes the engine refusal of a key through as it was sent', async () => {
		const { actions } = await import('./+page.server');
		mockedCreateClient.mockReturnValue({
			post: vi.fn(async () => {
				throw new ApiError(400, 'the key was refused');
			}),
		} as never);

		const cookies = mockCookies({ '__Host-sys_session': 'valid' });
		const result = await actions.renew({
			request: renewRequest('example-key'),
			fetch: mockFetch({}),
			cookies,
		} as never);
		expect(result).toMatchObject({ status: 400, data: { error: 'the key was refused' } });
	});
});

describe('license +page.server.ts actions', () => {
	it('exposes renew as the only action', async () => {
		const { actions } = await import('./+page.server');
		expect(Object.keys(actions)).toEqual(['renew']);
	});
});
