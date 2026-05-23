import { describe, it, expect, vi } from 'vitest';
import type { Cookies } from '@sveltejs/kit';

// The load function under test. SvelteKit's redirect() throws a Redirect object.
// We catch it and inspect status/location.
import { load } from './+layout.server';

// helpers

/** HTTP response factory. */
function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' },
	});
}

interface CookieStore {
	[key: string]: string;
}

/** Minimal cookies mock matching the SvelteKit Cookies interface. */
function mockCookies(initial: CookieStore = {}): Cookies {
	const store = { ...initial };
	const m = {
		get: vi.fn((name: string) => store[name] ?? undefined),
		set: vi.fn((name: string, value: string, _opts?: object) => {
			store[name] = value;
		}),
		delete: vi.fn((name: string, _opts?: object) => {
			delete store[name];
		}),
		getAll: vi.fn(() => []),
		serialize: vi.fn(() => ''),
	} as unknown as Cookies;
	return m;
}

/** Catch a redirect thrown by SvelteKit's redirect() helper. */
function catchRedirect(fn: () => unknown): Promise<{ status: number; location: string }> {
	return Promise.resolve(fn()).then(
		() => {
			throw new Error('expected redirect but got success');
		},
		(e: unknown) => {
			const err = e as { status?: number; location?: string };
			if (err.status && err.location) return { status: err.status, location: err.location };
			throw e; // re-throw real errors
		}
	);
}

// tests

describe('(admin)/+layout.server.ts load', () => {
	it('redirects to /login when there is no session cookie', async () => {
		const fetch = vi.fn(async (_url: string, _init: RequestInit) =>
			json({ setup_required: false })
		) as unknown as typeof globalThis.fetch;
		const cookies = mockCookies(); // no __Host-sys_session set

		const r = await catchRedirect(() => load({ fetch, cookies } as never));
		expect(r.status).toBe(302);
		expect(r.location).toBe('/login');
	});

	it('deletes the session cookie and redirects to /login when getMe fails', async () => {
		const fetch = vi.fn(async (url: string, _init: RequestInit) => {
			if (String(url).includes('/api/admin/setup')) return json({ setup_required: false });
			// /me endpoint: return 401 (invalid/expired token)
			if (String(url).includes('/api/admin/auth/me')) return json({ error: 'unauthorized' }, 401);
			return json({});
		}) as unknown as typeof globalThis.fetch;
		const cookies = mockCookies({ '__Host-sys_session': 'expired-token' });

		const r = await catchRedirect(() => load({ fetch, cookies } as never));

		// The delete has to repeat the attributes the cookie was set with. A
		// __Host- cookie cleared without Secure is discarded by the browser, the
		// dead session survives, and /login bounces its holder straight back here.
		expect(cookies.delete).toHaveBeenCalledWith('__Host-sys_session', {
			path: '/',
			httpOnly: true,
			secure: true,
			sameSite: 'strict',
		});
		expect(r.status).toBe(302);
		expect(r.location).toBe('/login');
	});

	it('returns user and fail-closed NO_ENTITLEMENTS when entitlements endpoint errors', async () => {
		const user = { id: 'u1', email: 'a@b.co', roles: ['admin'], tenant_id: 't', disabled: false, created_at: '' };
		const fetch = vi.fn(async (url: string, _init: RequestInit) => {
			if (String(url).includes('/api/admin/setup')) return json({ setup_required: false });
			if (String(url).includes('/api/admin/auth/me')) return json(user);
			// entitlements endpoint: simulate a network error
			if (String(url).includes('/api/admin/entitlements'))
				return Promise.reject(new Error('connection refused'));
			return json({});
		}) as unknown as typeof globalThis.fetch;
		const cookies = mockCookies({ '__Host-sys_session': 'valid-token' });

		const result = await load({ fetch, cookies } as never);

		expect(result).toBeDefined();
		expect(result!.user).toEqual(user);
		expect(result!.entitlements.plan).toBe('');
		expect(result!.entitlements.state).toBe('');
		expect(result!.entitlements.features).toEqual([]);
	});

	/*
	 * The migration count is the shell's own read: it belongs to the instance
	 * rather than to any page, and this load does not re-run when the reader
	 * moves between admin screens. A fetch in the header component would read
	 * outside load and cost a round trip after hydration on every page.
	 */
	describe('migration status', () => {
		function engine(migrate: () => Response | Promise<Response>, roles = ['super_admin']) {
			const seen: string[] = [];
			const user = {
				id: 'u1',
				email: 'a@b.co',
				roles,
				tenant_id: 't',
				disabled: false,
				created_at: '',
			};
			const fetch = vi.fn(async (url: string, _init: RequestInit) => {
				seen.push(String(url));
				if (String(url).includes('/api/admin/setup')) return json({ setup_required: false });
				if (String(url).includes('/api/admin/auth/me')) return json(user);
				if (String(url).includes('/api/admin/entitlements')) return json({ plan: '', state: '', features: [], caps: {} });
				if (String(url).includes('/api/admin/plugins/running')) return json({ plugins: ['schema'], withheld: [] });
				if (String(url).includes('/api/admin/migrate')) return migrate();
				return json({});
			}) as unknown as typeof globalThis.fetch;
			return { seen, fetch, cookies: mockCookies({ '__Host-sys_session': 'valid-token' }) };
		}

		it('reads the pending count in load, so no component has to', async () => {
			const { seen, fetch, cookies } = engine(() => json({ pending: 3 }));

			const result = await load({ fetch, cookies } as never);

			expect(seen.some((u) => u.includes('/api/admin/migrate'))).toBe(true);
			expect(result!.migrations).toEqual({ pending: 3 });
		});

		it('leaves the count unknown when the engine does not answer', async () => {
			// Reading a failure as zero would paint the chip green and claim the
			// database is in step with schemas nobody checked.
			const { fetch, cookies } = engine(() => Promise.reject(new Error('connection refused')));

			const result = await load({ fetch, cookies } as never);

			expect(result!.migrations).toEqual({ pending: null });
			expect(result!.user).toBeDefined();
		});

		it('does not ask an engine that does not run the schema plugin', async () => {
			const seen: string[] = [];
			const fetch = vi.fn(async (url: string) => {
				seen.push(String(url));
				if (String(url).includes('/api/admin/auth/me')) return json({ id: 'u1', email: 'a@b.co', roles: ['super_admin'] });
				if (String(url).includes('/api/admin/plugins/running')) return json({ plugins: [], withheld: [] });
				return json({});
			}) as unknown as typeof globalThis.fetch;

			const result = await load({ fetch, cookies: mockCookies({ '__Host-sys_session': 'valid-token' }) } as never);

			expect(result!.migrations).toBeNull();
			expect(seen.some((u) => u.includes('/api/admin/migrate'))).toBe(false);
		});

		it.each([['editor'], ['admin']])('does not ask on behalf of a %s, who may not read the queue', async (role) => {
			// The queue is every tenant's, so the engine holds it to super_admin
			// and an admin's request would only be refused.
			const { seen, fetch, cookies } = engine(() => json({ pending: 3 }), [role]);

			const result = await load({ fetch, cookies } as never);

			expect(result!.migrations).toBeNull();
			expect(seen.some((u) => u.includes('/api/admin/migrate'))).toBe(false);
		});
	});

	/*
	 * Which plugins run decides which pages exist. Every role reads the
	 * running list, an operator also reads why a plugin does not run, and an
	 * engine without the list is answered from that status report.
	 */
	describe('running plugins', () => {
		type Routes = Record<string, () => Response | Promise<Response>>;
		function engine(roles: string[], routes: Routes) {
			const seen: string[] = [];
			const fetch = vi.fn(async (url: string) => {
				seen.push(String(url));
				if (String(url).includes('/api/admin/auth/me')) return json({ id: 'u1', email: 'a@b.co', roles });
				for (const [path, answer] of Object.entries(routes)) if (String(url).includes(path)) return answer();
				return json({});
			}) as unknown as typeof globalThis.fetch;
			return { seen, run: () => load({ fetch, cookies: mockCookies({ '__Host-sys_session': 'valid-token' }) } as never) };
		}
		const status = {
			compiled: ['media', 'search', 'audit'],
			entitled: ['media', 'audit'],
			plugins: [
				{ name: 'media', compiled: true, entitled: true, requested: true, active: true, phase: 'running' },
				{ name: 'search', compiled: true, entitled: false, requested: true, active: false, phase: 'registered' },
				{ name: 'audit', compiled: true, entitled: true, requested: true, active: true, phase: 'running' },
			],
		};

		it('takes the running list the engine names, for an editor too', async () => {
			const { seen, run } = engine(['editor'], {
				'/api/admin/plugins/running': () => json({ plugins: ['media'], withheld: ['audit'] }),
			});
			const result = await run();
			expect(result!.plugins).toEqual({ state: 'named', running: ['media'], withheld: ['audit'] });
			expect(result!.pluginStatus).toBeNull();
			// The status report is an operator's, so an editor is never refused it.
			expect(seen.some((u) => u.includes('/api/admin/plugins/status'))).toBe(false);
		});

		it('reads the status report for an operator, so a page can say why its plugin does not run', async () => {
			const { run } = engine(['admin'], {
				'/api/admin/plugins/running': () => json({ plugins: ['media', 'audit'], withheld: [] }),
				'/api/admin/plugins/status': () => json(status),
			});
			const result = await run();
			expect(result!.pluginStatus).toEqual(status);
		});

		it('answers an engine without the list from the status report, less what is withheld', async () => {
			const { run } = engine(['super_admin'], {
				'/api/admin/plugins/running': () => json({ error: 'not found' }, 404),
				'/api/admin/plugins/status': () => json(status),
				'/api/admin/entitlements': () => json({ plan: '', state: '', features: [], withheld: ['audit'] }),
			});
			const result = await run();
			expect(result!.plugins).toEqual({ state: 'named', running: ['media'], withheld: ['audit'] });
		});

		it('shows every page to an editor on an engine without the list', async () => {
			const { run } = engine(['editor'], {
				'/api/admin/plugins/running': () => json({ error: 'not found' }, 404),
			});
			expect((await run())!.plugins).toEqual({ state: 'unnamed' });
		});

		it('keeps a failed read apart from an engine that runs nothing', async () => {
			const { run } = engine(['super_admin'], {
				'/api/admin/plugins/running': () => json({ error: 'unavailable' }, 503),
			});
			expect((await run())!.plugins).toEqual({ state: 'unread' });
		});

		it('does not read the customization from an engine without the multitenant plugin', async () => {
			const { seen, run } = engine(['admin'], {
				'/api/admin/plugins/running': () => json({ plugins: ['media'], withheld: [] }),
			});
			const result = await run();
			expect(result!.customization.entitled).toBe(false);
			expect(seen.some((u) => u.includes('/api/admin/customization'))).toBe(false);
		});

		it('reads the customization while the multitenant plugin runs', async () => {
			const { seen, run } = engine(['admin'], {
				'/api/admin/plugins/running': () => json({ plugins: ['multitenant'], withheld: [] }),
				'/api/admin/customization': () => json({ entitled: true, settings: {}, pages: [] }),
			});
			await run();
			expect(seen.some((u) => u.includes('/api/admin/customization'))).toBe(true);
		});

		// Every page reads its title, logo and tab icon from this one copy.
		it('hands the session tenant brand to every page', async () => {
			const { run } = engine(['editor'], {
				'/api/admin/plugins/running': () => json({ plugins: ['multitenant'], withheld: [] }),
				'/api/admin/customization': () =>
					json({ entitled: true, settings: { brand: { name: 'Acme', logo_url: '/api/v1/media/1/l.png', accent: '#0a7cff', welcome: 'Hi', favicon_url: '/api/v1/media/2/i.png' } }, pages: [] }),
			});
			expect((await run())!.brand).toEqual({ name: 'Acme', logo_url: '/api/v1/media/1/l.png', accent: '#0a7cff', favicon_url: '/api/v1/media/2/i.png' });
		});
	});

	/*
	 * The license module serves its own links and says whether this console may
	 * renew. Its route answers every signed-in role, and an engine that links
	 * no module is not asked at all.
	 */
	describe('license module', () => {
		type Routes = Record<string, () => Response | Promise<Response>>;
		function engine(roles: string[], routes: Routes) {
			const seen: string[] = [];
			const fetch = vi.fn(async (url: string) => {
				seen.push(String(url));
				if (String(url).includes('/api/admin/auth/me')) return json({ id: 'u1', email: 'a@b.co', roles });
				for (const [path, answer] of Object.entries(routes)) if (String(url).includes(path)) return answer();
				return json({});
			}) as unknown as typeof globalThis.fetch;
			return { seen, run: () => load({ fetch, cookies: mockCookies({ '__Host-sys_session': 'valid-token' }) } as never) };
		}
		const presentation = {
			links: [
				{ rel: 'support', label: 'Help', url: 'https://example.test/help' },
				{ rel: 'purchase', label: 'Buy', url: 'javascript:alert(1)' },
			],
			renew: true,
		};
		const asked = (seen: string[]) => seen.some((u) => new URL(u, 'http://x').pathname === '/api/admin/license');

		it('reads the links and the renewal the module serves, keeping only the safe links', async () => {
			const { seen, run } = engine(['super_admin'], {
				'/api/admin/entitlements': () => json({ plan: 'example', state: 'active', features: [], license_module: true }),
				'/api/admin/license': () => json(presentation),
			});
			const result = await run();
			expect(asked(seen)).toBe(true);
			expect(result!.licensing).toEqual({
				links: [{ rel: 'support', label: 'Help', href: 'https://example.test/help' }],
				renew: true,
			});
		});

		it('does not ask an engine that says it links no license module', async () => {
			const { seen, run } = engine(['super_admin'], {
				'/api/admin/entitlements': () => json({ plan: 'free', state: 'free', features: [], license_module: false }),
				'/api/admin/license': () => json(presentation),
			});
			const result = await run();
			expect(asked(seen)).toBe(false);
			expect(result!.licensing).toEqual({ links: [], renew: false });
		});

		it('asks on behalf of an editor, whom the entitlements are refused, and reads a 404 as no links', async () => {
			const { seen, run } = engine(['editor'], {
				'/api/admin/entitlements': () => json({ error: 'forbidden' }, 403),
				'/api/admin/license': () => json({ error: 'not found' }, 404),
			});
			const result = await run();
			expect(asked(seen)).toBe(true);
			expect(result!.licensing).toEqual({ links: [], renew: false });
		});

		it('gives an editor the support link on an engine that links a module', async () => {
			const { run } = engine(['editor'], {
				'/api/admin/entitlements': () => json({ error: 'forbidden' }, 403),
				'/api/admin/license': () => json(presentation),
			});
			expect((await run())!.licensing).toEqual({
				links: [{ rel: 'support', label: 'Help', href: 'https://example.test/help' }],
				renew: true,
			});
		});
	});

	it('returns user + entitlements on full happy path', async () => {
		const user = { id: 'u1', email: 'a@b.co', roles: ['admin'], tenant_id: 't', disabled: false, created_at: '' };
		const entitlements = { plan: 'example', state: 'active', features: ['example'], caps: {} };
		const fetch = vi.fn(async (url: string, _init: RequestInit) => {
			if (String(url).includes('/api/admin/setup')) return json({ setup_required: false });
			if (String(url).includes('/api/admin/auth/me')) return json(user);
			if (String(url).includes('/api/admin/entitlements')) return json(entitlements);
			return json({});
		}) as unknown as typeof globalThis.fetch;
		const cookies = mockCookies({ '__Host-sys_session': 'valid-token' });

		const result = await load({ fetch, cookies } as never);

		expect(result).toBeDefined();
		expect(result!.user).toEqual(user);
		expect(result!.entitlements).toEqual(entitlements);
	});
});
