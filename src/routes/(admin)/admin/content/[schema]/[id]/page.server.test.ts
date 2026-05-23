import { describe, it, expect, vi } from 'vitest';
import type { Cookies } from '@sveltejs/kit';

// authedHeaders is left real: the relationship writes build their headers
// through it, and a stub would hide a call that sends Bearer alone.
vi.mock('$lib/server/authz', async (importOriginal) => ({
	...((await importOriginal()) as object),
	requireUser: vi.fn(async () => ({ id: 'u1', email: 'admin@test.invalid' }) as never),
	// Backed by the event's own fetch, so the action's writes land in the same
	// call log the relationship calls do. It throws on a non-2xx the way the
	// real client does: a mock that resolves whatever the engine answered turns
	// a refused write into a passing test.
	authedClient: vi.fn((event: { fetch: typeof fetch }) => {
		const send = async (method: string, path: string, body: unknown) => {
			const res = await event.fetch(path, {
				method,
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});
			if (!res.ok) throw new Error(`${method} ${path} answered ${res.status}`);
			return res.json();
		};
		return {
			put: (path: string, body: unknown) => send('PUT', path, body),
			post: (path: string, body: unknown) => send('POST', path, body)
		} as never;
	}),
	stripProtectedFields: vi.fn((v: unknown) => v)
}));

vi.mock('@lyeve-labs/client', () => ({
	// Backed by the fetch it is handed, so the localization reads land in the
	// same call log the entry and revision reads do.
	createClient: vi.fn((fetchFn: typeof fetch) => ({
		get: async (path: string) => {
			const res = await fetchFn(path);
			if (!res.ok) throw new Error(`GET ${path} answered ${res.status}`);
			return res.json();
		}
	}) as never),
	ApiError: class ApiError extends Error {
		status = 500;
	}
}));

vi.mock('@lyeve-labs/client-rest', () => ({
	getSchema: vi.fn(async () => ({ name: 'article', with_draft_publish: true, fields: [] }))
}));

import { load, actions } from './+page.server';
import type { PluginSet } from '$lib/plugins';

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

function mockCookies(): Cookies {
	return {
		get: vi.fn((name: string) => (name === '__Host-csrf' ? 'csrf-tok' : 'token'))
	} as unknown as Cookies;
}

const entry = { id: 'e1', created_at: '', updated_at: '', title: 'One', body: {}, status: 'draft' };

/**
 * Route fetch by path so the three concurrent calls in load do not depend on
 * the order they resolve in.
 */
function fetchWith(revisionsBody: unknown, revisionsStatus = 200) {
	return vi.fn(async (path: string) => {
		if (path.includes('/revisions')) return json(revisionsBody, revisionsStatus);
		if (path.includes('/api/admin/content?')) return json({ data: [] });
		return json(entry);
	}) as unknown as typeof globalThis.fetch;
}

const none: PluginSet = { state: 'named', running: [], withheld: [] };
const localized: PluginSet = { state: 'named', running: ['localization'], withheld: [] };

async function loadWith(revisionsBody: unknown, revisionsStatus = 200, plugins = none) {
	return (await load({
		fetch: fetchWith(revisionsBody, revisionsStatus),
		cookies: mockCookies(),
		params: { schema: 'article', id: 'e1' },
		parent: async () => ({ plugins })
	} as never)) as { revisions: unknown[]; localization: unknown };
}

describe('content editor load, translations', () => {
	it('reads nothing from the localization plugin while it does not run', async () => {
		const fetchFn = fetchWith({ data: [], total: 0 });
		await load({
			fetch: fetchFn,
			cookies: mockCookies(),
			params: { schema: 'article', id: 'e1' },
			parent: async () => ({ plugins: none })
		} as never);
		const paths = (fetchFn as unknown as { mock: { calls: [string][] } }).mock.calls.map((c) => c[0]);
		expect(paths.some((p) => p.includes('/translations') || p.includes('/localization/'))).toBe(false);
		expect((await loadWith({ data: [], total: 0 })).localization).toBeNull();
	});

	it('loads the locales and the entry\'s translations while the plugin runs', async () => {
		const fetchFn = vi.fn(async (path: string) => {
			if (path.includes('/localization/locales')) {
				return json({ default_locale: 'en', enabled_locales: ['en', 'fr'] });
			}
			if (path.includes('/translations')) {
				return json({ data: [{ locale: 'fr', title: 'Un', body: {}, translation_status: 'outdated' }], total: 1 });
			}
			if (path.includes('/revisions')) return json({ data: [], total: 0 });
			return json(entry);
		}) as unknown as typeof globalThis.fetch;
		const result = (await load({
			fetch: fetchFn,
			cookies: mockCookies(),
			params: { schema: 'article', id: 'e1' },
			parent: async () => ({ plugins: localized })
		} as never)) as { localization: { locales: unknown; translations: { locale: string }[]; unavailable: boolean } };
		expect(result.localization.unavailable).toBe(false);
		expect(result.localization.locales).toEqual({ default_locale: 'en', enabled_locales: ['en', 'fr'], fallback_chain: [] });
		expect(result.localization.translations.map((t) => t.locale)).toEqual(['fr']);
	});

	it('keeps the panel, marked unavailable, when the running plugin does not answer', async () => {
		const fetchFn = vi.fn(async (path: string) => {
			if (path.includes('/localization/') || path.includes('/translations')) return json({ error: 'x' }, 503);
			if (path.includes('/revisions')) return json({ data: [], total: 0 });
			return json(entry);
		}) as unknown as typeof globalThis.fetch;
		const result = (await load({
			fetch: fetchFn,
			cookies: mockCookies(),
			params: { schema: 'article', id: 'e1' },
			parent: async () => ({ plugins: localized })
		} as never)) as { localization: { unavailable: boolean } };
		expect(result.localization.unavailable).toBe(true);
	});
});

describe('content editor load, revisions', () => {
	it('unwraps the paginated envelope the endpoint answers with', async () => {
		const result = await loadWith({ data: [{ id: 'r2' }, { id: 'r1' }], total: 2 });

		// Handed through whole, the page reads `.length` off the envelope, finds
		// undefined, and renders no History control for any entry.
		expect(Array.isArray(result.revisions)).toBe(true);
		expect(result.revisions).toHaveLength(2);
	});

	it('accepts a bare array as well as the envelope', async () => {
		const result = await loadWith([{ id: 'r1' }]);
		expect(result.revisions).toHaveLength(1);
	});

	it('reports no revisions rather than failing the page when the call errors', async () => {
		const result = await loadWith({ error: 'nope' }, 503);
		expect(result.revisions).toEqual([]);
	});

	it('reports no revisions when the envelope carries none', async () => {
		const result = await loadWith({ data: [], total: 0 });
		expect(result.revisions).toEqual([]);
	});

	it('flattens the row columns into the one data object the panel reads', async () => {
		// A revision carries title, body, meta and status as separate columns.
		// Passed through as they arrive, `data` is absent, and the panel's
		// summary calls Object.keys on it, which throws during hydration and
		// leaves the History control toggling nothing.
		const result = await loadWith({
			data: [
				{
					id: 'r1',
					revision_num: 2,
					created_at: '2026-01-01T00:00:00Z',
					created_by: 'u1',
					title: 'Two',
					body: { body: 'v2' },
					meta: { locale: 'en' },
					status: 'published'
				}
			],
			total: 1
		});

		expect(result.revisions[0]).toEqual({
			id: 'r1',
			revision_num: 2,
			created_at: '2026-01-01T00:00:00Z',
			created_by: 'u1',
			data: { body: 'v2', title: 'Two', locale: 'en', _status: 'published' }
		});
	});

	it('gives a row with no body an empty data object rather than none', async () => {
		const result = await loadWith({ data: [{ id: 'r1', revision_num: 1 }], total: 1 });
		const rev = result.revisions[0] as { data: Record<string, unknown> };
		expect(rev.data).toEqual({ _status: 'published' });
	});
});

// save: many_to_many reconcile

interface Call {
	method: string;
	path: string;
	body?: string;
	csrf?: string;
}

/**
 * A fetch that records what the action asked for and answers the relationship
 * listing with `held`.
 */
function relationFetch(held: { id: string; target_id: string }[]) {
	const calls: Call[] = [];
	const fn = vi.fn(async (path: string, init?: RequestInit) => {
		calls.push({
			method: init?.method ?? 'GET',
			path,
			body: typeof init?.body === 'string' ? init.body : undefined,
			csrf: (init?.headers as Record<string, string> | undefined)?.['X-CSRF-Token']
		});
		if (path.includes('/relationships?')) return json({ data: held, total: held.length });
		return json({ ok: true });
	}) as unknown as typeof globalThis.fetch;
	return { fn, calls };
}

function saveEvent(fetchFn: typeof globalThis.fetch, m2m: Record<string, string[]>) {
	const fd = new FormData();
	fd.set('data', JSON.stringify({ title: 'One' }));
	fd.set('m2m_relations', JSON.stringify(m2m));
	return {
		fetch: fetchFn,
		cookies: mockCookies(),
		params: { schema: 'article', id: 'e1' },
		request: { formData: async () => fd }
	} as never;
}

async function runSave(event: never) {
	// A successful save ends in a redirect, which SvelteKit throws.
	try {
		const result = await actions.save(event);
		return result as { data?: { error?: string } } | undefined;
	} catch (e) {
		const err = e as { status?: number; location?: string };
		if (err.status === 303) return undefined;
		throw e;
	}
}

describe('content editor save, many_to_many fields', () => {
	it('adds the newly selected targets and removes the deselected ones', async () => {
		const { fn, calls } = relationFetch([
			{ id: 'rel-keep', target_id: 't1' },
			{ id: 'rel-drop', target_id: 't2' }
		]);

		const failure = await runSave(saveEvent(fn, { tags: ['t1', 't3'] }));
		expect(failure, 'a save carrying a many_to_many field must not fail').toBeUndefined();

		const deletes = calls.filter((c) => c.method === 'DELETE');
		expect(deletes.map((c) => c.path)).toEqual([
			'/api/admin/content/e1/relationships/rel-drop'
		]);

		// Both writes carry the double-submit token. Without it the engine answers
		// 403 to a same-origin call, and every save of a many_to_many field fails
		// for a reason that names the content route rather than the caller.
		for (const call of [...deletes, ...calls.filter((c) => c.method === 'POST')]) {
			expect(call.csrf, `${call.method} ${call.path} must carry the CSRF token`).toBe(
				'csrf-tok'
			);
		}

		const posts = calls.filter((c) => c.method === 'POST');
		expect(posts).toHaveLength(1);
		expect(JSON.parse(posts[0].body ?? '{}')).toMatchObject({
			target_id: 't3',
			field_name: 'tags',
			rel_type: 'many_to_many'
		});
	});

	it('never names a field where the route expects a relationship id', async () => {
		const { fn, calls } = relationFetch([]);
		await runSave(saveEvent(fn, { tags: ['t1'] }));

		// A PUT of the whole set to .../relationships/tags answers `invalid UUID
		// for parameter "relID"` and fails every save of an entry carrying a
		// many_to_many field.
		expect(calls.some((c) => c.path.endsWith('/relationships/tags'))).toBe(false);
		expect(calls.some((c) => c.method === 'PUT' && c.path.includes('/relationships'))).toBe(false);
	});

	it('leaves a set that has not changed alone', async () => {
		const { fn, calls } = relationFetch([{ id: 'rel-1', target_id: 't1' }]);
		await runSave(saveEvent(fn, { tags: ['t1'] }));

		expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(0);
		expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
	});
});


// restore: the rollback payload

function restoreEvent(fetchFn: typeof globalThis.fetch, revNum: string) {
	const fd = new FormData();
	fd.set('rev_num', revNum);
	return {
		fetch: fetchFn,
		cookies: mockCookies(),
		params: { schema: 'article', id: 'e1' },
		request: { formData: async () => fd }
	} as never;
}

async function runRestore(event: never) {
	try {
		return (await actions.restore(event)) as { data?: { error?: string } } | undefined;
	} catch (e) {
		const err = e as { status?: number };
		if (err.status === 303) return undefined;
		throw e;
	}
}

describe('content editor restore', () => {
	it('names the revision by its number under the key the route reads', async () => {
		const { fn, calls } = relationFetch([]);

		const failure = await runRestore(restoreEvent(fn, '2'));
		expect(failure, 'restoring a listed revision must not fail').toBeUndefined();

		const rollback = calls.find((c) => c.path.endsWith('/rollback'));
		expect(rollback?.method).toBe('POST');
		// The route reads the sequence number under `to_revision` and no other
		// key.
		expect(JSON.parse(rollback?.body ?? '{}')).toEqual({ to_revision: 2 });
	});

	it('refuses a submission that names no revision instead of calling rollback', async () => {
		const { fn, calls } = relationFetch([]);

		const failure = await runRestore(restoreEvent(fn, ''));
		expect(failure?.data?.error).toBeTruthy();
		expect(calls.some((c) => c.path.endsWith('/rollback'))).toBe(false);
	});
});

/**
 * Records the PUT payloads and answers every call with `status`.
 */
function putRecorder(status = 200) {
	const puts: { path: string; body: Record<string, unknown> }[] = [];
	const fn = (async (path: string, init?: RequestInit) => {
		if (init?.method === 'PUT') puts.push({ path, body: JSON.parse(String(init.body)) });
		return new Response(JSON.stringify({ ok: true }), {
			status,
			headers: { 'Content-Type': 'application/json' }
		});
	}) as unknown as typeof globalThis.fetch;
	return { fn, puts };
}

function titleSaveEvent(fetchFn: typeof globalThis.fetch) {
	const fd = new FormData();
	fd.set('data', JSON.stringify({ title: 'Edited', summary: 'kept in body' }));
	return {
		fetch: fetchFn,
		cookies: mockCookies(),
		params: { schema: 'article', id: 'e1' },
		request: { formData: async () => fd }
	} as never;
}

describe('content editor save, the title column', () => {
	it('sends title as the column and keeps it in the body the schema validates', async () => {
		const { fn, puts } = putRecorder();

		expect(await runSave(titleSaveEvent(fn))).toBeUndefined();

		const put = puts.find((c) => c.path.includes('/api/admin/content/e1'));
		expect(put, 'the save must PUT the entry').toBeDefined();

		// The load overlays the title column on top of body, so a title only in
		// body is written where nothing reads it and the edit vanishes on the
		// next render.
		expect(put!.body.title, 'title must be sent as the column the API declares').toBe('Edited');

		const body = put!.body.body as Record<string, unknown>;
		expect(body.summary, 'other fields still belong in body').toBe('kept in body');
		// The engine validates body against the schema, and title is one of the
		// schema's fields. Lifted out of body, a schema that declares it required
		// refuses the whole write and nothing is saved at all.
		expect(body.title, 'title is a schema field, so body must still carry it').toBe('Edited');
	});

	it('reports a failure rather than redirecting when the engine refuses the write', async () => {
		const { fn } = putRecorder(422);

		const failure = await runSave(titleSaveEvent(fn));

		expect(failure?.data?.error, 'a refused PUT must not read as a saved entry').toBeTruthy();
	});
});

function translationEvent(fetchFn: typeof globalThis.fetch, fields: Record<string, string>) {
	const fd = new FormData();
	for (const [k, v] of Object.entries(fields)) fd.set(k, v);
	return {
		fetch: fetchFn,
		cookies: mockCookies(),
		params: { schema: 'article', id: 'e1' },
		request: { formData: async () => fd }
	} as never;
}

async function runAction(name: 'saveTranslation' | 'markTranslated', event: never) {
	try {
		return (await actions[name](event)) as { status?: number; data?: { error?: string } } | undefined;
	} catch (e) {
		const err = e as { status?: number; location?: string };
		if (err.status === 303) return { status: 303, location: err.location } as never;
		throw e;
	}
}

describe('content editor translations', () => {
	it('creates the row for a locale that has none and updates one that exists', async () => {
		const { fn, calls } = relationFetch([]);
		const data = JSON.stringify({ title: 'Un', body: '<p>Salut</p>' });

		let out = await runAction('saveTranslation', translationEvent(fn, { locale: 'fr', exists: 'false', data }));
		expect(out).toMatchObject({ status: 303, location: '/admin/content/article/e1' });
		expect(calls.at(-1)).toMatchObject({ method: 'POST', path: '/api/admin/content/e1/translations' });
		expect(JSON.parse(calls.at(-1)?.body ?? '{}')).toEqual({
			locale: 'fr',
			title: 'Un',
			body: { title: 'Un', body: '<p>Salut</p>' }
		});

		out = await runAction('saveTranslation', translationEvent(fn, { locale: 'fr', exists: 'true', data }));
		expect(out).toMatchObject({ status: 303 });
		expect(calls.at(-1)).toMatchObject({ method: 'PUT', path: '/api/admin/content/e1/translations/fr' });
		// A save carries no status, so an outdated row stays outdated until marked.
		expect(JSON.parse(calls.at(-1)?.body ?? '{}')).not.toHaveProperty('translation_status');
	});

	it('marks a locale translated without sending its text', async () => {
		const { fn, calls } = relationFetch([]);
		const out = await runAction('markTranslated', translationEvent(fn, { locale: 'de' }));
		expect(out).toMatchObject({ status: 303 });
		expect(calls.at(-1)).toMatchObject({ method: 'PUT', path: '/api/admin/content/e1/translations/de' });
		expect(JSON.parse(calls.at(-1)?.body ?? '{}')).toEqual({ translation_status: 'translated' });
	});

	it('returns the refusal against the locale it was about', async () => {
		const fn = vi.fn(async () => json({ error: 'nope' }, 402)) as unknown as typeof globalThis.fetch;
		const out = await runAction('saveTranslation', translationEvent(fn, { locale: 'fr', exists: 'true', data: '{}' }));
		expect(out?.status).toBe(400);
		expect(out?.data).toMatchObject({ translationLocale: 'fr' });
		expect(out?.data?.error).toBeTruthy();
	});
});
