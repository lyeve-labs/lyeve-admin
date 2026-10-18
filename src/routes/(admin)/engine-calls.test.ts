import { describe, it, expect, vi } from 'vitest';
import type { Cookies } from '@sveltejs/kit';

import { load as shell } from './+layout.server';
import { actions, load as jobs } from './admin/jobs/+page.server';
import { actions as users } from './admin/users/+page.server';

/*
 * The engine calls one page visit and one write cost. A page that wants only
 * the account reads it itself, because awaiting the shell's data on a
 * client-side navigation makes the server run the whole shell first. Within
 * one request the account is asked for once, whoever asks.
 */

const admin = { id: 'u1', email: 'a@b.test', roles: ['super_admin'], tenant_id: 'default' };

/** An instance on the free plan, as a development engine answers. */
const ENTITLEMENTS = { plan: 'free', state: 'active', features: [], withheld: [], tenant_quota: 0 };

/** The plugins whose reads the shell makes: the schema's migration count and the tenant's frame. */
const STATUS = {
	compiled: ['cron', 'multitenant', 'schema'],
	entitled: ['cron', 'multitenant', 'schema'],
	plugins: ['cron', 'multitenant', 'schema'].map((name) => ({ name, compiled: true, entitled: true, phase: 'running' })),
};

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** An engine that answers every read, and records each call as "METHOD /path". */
function engine(me: () => Response = () => json(admin)) {
	const calls: string[] = [];
	const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const path = new URL(String(input), 'http://engine').pathname;
		calls.push(`${init?.method ?? 'GET'} ${path}`);
		if (path === '/api/admin/auth/me') return me();
		if (path === '/api/admin/jobs' && init?.method === 'POST') return json({ id: 'j1' }, 201);
		if (path === '/api/admin/jobs') return json([]);
		if (path === '/api/admin/entitlements') return json(ENTITLEMENTS);
		if (path === '/api/admin/plugins/status') return json(STATUS);
		if (path === '/api/admin/migrate') return json({ pending: [] });
		return json({});
	}) as unknown as typeof globalThis.fetch;
	return { calls, fetch };
}

function cookies(): Cookies {
	return {
		get: vi.fn((name: string) => (name === '__Host-sys_session' ? 'tok' : name === '__Host-csrf' ? 'c' : undefined)),
		set: vi.fn(),
		delete: vi.fn(),
		getAll: vi.fn(() => []),
		serialize: vi.fn(() => ''),
	} as unknown as Cookies;
}

/**
 * One request, as SvelteKit serves it: `event()` is the event it hands an
 * action or a load, and `shell()` runs the shell's load at most once. A
 * page's parent() runs that same shell load, which is what SvelteKit does on
 * the server when the browser already holds the shell's data.
 */
function request(fetch: typeof globalThis.fetch, method = 'GET', body?: FormData, path = '/admin/jobs') {
	const url = new URL(`http://localhost${path}`);
	const req = new Request(url, { method, body });
	const jar = cookies();
	let ran: Promise<unknown> | undefined;
	const shellOnce = () => (ran ??= Promise.resolve(shell(event())));
	const event = () =>
		({
			fetch,
			cookies: jar,
			url,
			request: req,
			params: {},
			route: { id: `/(admin)${path}` },
			parent: shellOnce,
		}) as never;
	return { event, shell: shellOnce, cookies: jar };
}

/** What an action resolved to, or what it threw. */
function settle(outcome: unknown): Promise<unknown> {
	return Promise.resolve(outcome).catch((e: unknown) => e);
}

function jobForm(): FormData {
	const form = new FormData();
	form.set('name', 'nightly');
	form.set('schedule', '0 * * * *');
	form.set('endpoint', 'https://example.test/hook');
	form.set('enabled', 'on');
	return form;
}

describe('engine calls', () => {
	it('a client-side visit to jobs asks for the account and the list, and nothing of the shell', async () => {
		const { calls, fetch } = engine();

		await jobs(request(fetch).event());

		expect(calls).toEqual(['GET /api/admin/auth/me', 'GET /api/admin/jobs']);
	});

	it('a full load asks for the account once, for the shell and the page together', async () => {
		const alone = engine();
		await request(alone.fetch).shell();

		const { calls, fetch } = engine();
		const req = request(fetch);
		await Promise.all([req.shell(), jobs(req.event())]);

		expect(calls.filter((c) => c === 'GET /api/admin/auth/me')).toHaveLength(1);
		expect(calls).toHaveLength(alone.calls.length + 1);
	});

	it('a write asks for the account once and then writes', async () => {
		const { calls, fetch } = engine();

		await settle(actions.create(request(fetch, 'POST', jobForm()).event()));

		expect(calls).toEqual(['GET /api/admin/auth/me', 'POST /api/admin/jobs']);
	});

	it('the page that renders after a write in the same request asks for the account once more', async () => {
		const { calls, fetch } = engine();
		const req = request(fetch, 'POST', jobForm());

		await settle(actions.create(req.event()));
		await Promise.all([req.shell(), jobs(req.event())]);

		expect(calls.filter((c) => c === 'GET /api/admin/auth/me')).toHaveLength(2);
	});

	it('setting your own password without JavaScript ends on the sign-in page', async () => {
		let live = true;
		const { calls, fetch } = engine(() => (live ? json(admin) : json({ error: 'unauthorized' }, 401)));
		// The engine ends every session of an account whose password a super admin sets.
		const ending = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const answer = await fetch(input, init);
			if (init?.method && init.method !== 'GET' && String(input).includes(`/users/${admin.id}/password`)) live = false;
			return answer;
		}) as unknown as typeof globalThis.fetch;
		const form = new FormData();
		form.set('id', admin.id);
		form.set('new_password', 'a-new-long-passphrase');
		const req = request(ending, 'POST', form, '/admin/users');

		await settle(users.setPassword(req.event()));
		const after = (await settle(req.shell())) as { status?: number; location?: string };

		expect(calls).toContain(`PUT /api/admin/users/${admin.id}/password`);
		expect(after.status).toBe(302);
		expect(after.location).toContain('/login?ended=1');
		expect(req.cookies.delete).toHaveBeenCalled();
	});

	it('a write from a session the engine ended is refused before it reaches the engine', async () => {
		const { calls, fetch } = engine(() => json({ error: 'unauthorized' }, 401));

		const err = (await settle(actions.create(request(fetch, 'POST', jobForm()).event()))) as {
			status?: number;
		};

		expect(err.status).toBe(401);
		expect(calls).toEqual(['GET /api/admin/auth/me']);
	});

	it('each write asks again, so a session ended after the last one is refused', async () => {
		let live = true;
		const { calls, fetch } = engine(() => (live ? json(admin) : json({ error: 'unauthorized' }, 401)));

		await settle(actions.create(request(fetch, 'POST', jobForm()).event()));
		live = false;
		const err = (await settle(actions.create(request(fetch, 'POST', jobForm()).event()))) as {
			status?: number;
		};

		expect(err.status).toBe(401);
		expect(calls.filter((c) => c.startsWith('POST'))).toHaveLength(1);
	});

	it('a failed list read is still drawn as a failure', async () => {
		const { fetch } = engine();
		const failing = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
			String(input).includes('/api/admin/jobs') ? json({ error: 'down' }, 503) : fetch(input, init)
		) as unknown as typeof globalThis.fetch;

		const out = (await jobs(request(failing).event())) as { jobs: { ok: boolean; gate?: { state: string } } };

		expect(out.jobs.ok).toBe(false);
		expect(out.jobs.gate?.state).toBe('unavailable');
	});
});
